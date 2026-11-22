/** The tiles of the monitoring page: state per background job and schedule. */
import fs from 'node:fs';
import path from 'node:path';
import { DAILY_JOBS } from './timesOfDay';
import { imgDlPending, imgDlReset, tile, tiles } from './tiles';
import { PDF_JOB_DIR } from '../infra/appPaths';
import { reportError } from '../infra/error';
import { Degradations } from '../infra/result';
import type { ManagementContext } from './context';

// One deadline for both tiles; three minutes at a tick of twenty seconds.
const JOB_FRESH_MS = 3 * 60_000;

type Tile = Record<string, unknown>;

/** The subtitle as codes: the tile is created without a request, the UI translates. `sub` stays for the app. */
type SubPart = { code: string; values?: Record<string, number | string>; ago?: 'holding' };

const part = (code: string, values?: Record<string, number | string>): SubPart =>
  values ? { code, values } : { code };

type Tiles = Record<string, Tile>;

const count = (ab: Degradations, p: Promise<number>, location: string) => ab.orElse(location, p, 0);

/** A JSON state from laufzustand; a damaged one counts as none. */
async function readRunState<T>(k: ManagementContext, ab: Degradations, key: string): Promise<T | null> {
  const raw = await ab.orElse(key, k.jobQueue.readState(key), null);
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function blIdsTile(alt: Tile, mapped: number, total: number): Tile | null {
  if (total <= 0) return null;
  return {
    ...alt,
    status: mapped < total ? (alt.status === 'running' ? 'running' : 'idle') : 'done',
    progress: mapped,
    total: total,
    sub: mapped < total ? `${mapped} / ${total} gemappt` : `Alle ${total} gemappt`,
    sub_parts: [mapped < total ? part('part_mapped', { n: mapped, total }) : part('all_mapped', { n: total })],
  };
}

/** Counted once: open, done and failed from the same query. */
async function instructionJobs(k: ManagementContext, ab: Degradations) {
  const z = await ab.orElse('anleitungen', k.jobQueue.countKind('instructions'), null);
  return { open: z ? z.pending + z.running : 0, done: z?.done ?? 0, error: z?.error ?? 0 };
}

function instructionsTile(alt: Tile, a: { open: number; done: number; error: number }): Tile | null {
  const total = a.open + a.done + a.error;
  if (total <= 0) return null;
  return {
    ...alt,
    status: a.open > 0 ? 'running' : 'done',
    progress: a.done,
    total: total,
    sub: a.open > 0 ? `${a.open} ausstehend` : 'Alle erledigt',
    sub_parts: [a.open > 0 ? part('pending', { n: a.open }) : part('all_done')],
  };
}

async function bricksetTile(k: ManagementContext, ab: Degradations): Promise<Tile> {
  const { wartend, faellig } = await ab.orElse('brickset', k.externalSources.brickset.numbers(), {
    wartend: 0,
    faellig: 0,
  });
  return {
    label: 'Brickset Retry Queue',
    status: wartend === 0 ? 'done' : 'idle',
    progress: 0,
    total: wartend,
    lastRun: null,
    sub:
      wartend === 0
        ? 'Keine ausstehenden Einträge'
        : faellig > 0
          ? `${faellig} Sets bereit zum Retry, ${wartend - faellig} warten`
          : `${wartend} Sets warten auf morgen`,
    sub_parts: [
      wartend === 0
        ? part('none_pending')
        : faellig > 0
          ? part('retry_ready', { n: faellig, w: wartend - faellig })
          : part('wait_tomorrow', { n: wartend }),
    ],
  };
}

/** "running" means: has done something RECENTLY (timestamp of the state). */
const isFresh = (k: ManagementContext, time: unknown) =>
  typeof time === 'number' && k.clock.now() - time < JOB_FRESH_MS;

/** Inventory, reloading and catalog in ONE tile, otherwise it would report "all cached"
 * while the background job is reloading. */
/** Capped to the really open images: that heals an orphaned counter after a crash. */
async function imagesInProgress(k: ManagementContext, ab: Degradations, open: number): Promise<number> {
  const active = await ab.orElse('bilder', imgDlPending(k), 0);
  if (open === 0 && active > 0) {
    await imgDlReset(k);
    return 0;
  }
  return Math.min(active, open);
}

async function redownloadState(k: ManagementContext, ab: Degradations) {
  const reDl = await readRunState<{ running?: boolean; at?: number; phase?: string; done?: number; total?: number }>(
    k,
    ab,
    'imgredl_status',
  );
  const running = reDl?.running === true && (typeof reDl.at !== 'number' || isFresh(k, reDl.at));
  const sub = !running
    ? null
    : reDl?.phase === 'scanning'
      ? '↻ suche fehlende Bilder…'
      : `↻ ${reDl?.done || 0}/${reDl?.total || 0} fehlende neu geladen`;
  return { reDl, running, sub };
}

async function imageTile(k: ManagementContext, ab: Degradations): Promise<Tile> {
  const [openParts, finished, setMinifigs, inventoryMinifigs, openCatalog] = await Promise.all([
    count(ab, k.management.partImagesOpen(), 'bilder'),
    count(ab, k.management.partImagesDone(), 'bilder'),
    count(ab, k.management.setMinifigImagesOpen(), 'bilder'),
    // Figures of the inventory are stored locally by the same run; they belong to the open set.
    count(ab, k.management.holdingMinifigImagesOpen(), 'bilder'),
    count(ab, k.management.catalogImagesOpen(), 'bilder'),
  ]);
  const open = openParts + setMinifigs + inventoryMinifigs;
  const job = await ab.orElse('bilder', tile(k, 'imgDl'), null);
  const active = await imagesInProgress(k, ab, open);
  const { reDl, running: reDlRunning, sub: reDlSub } = await redownloadState(k, ab);
  // "running" means: has recently done something, according to the database.
  const lastRun = await readRunState<{ zeit?: number }>(k, ab, 'imgqueue_last_run');
  const sinceRun = lastRun?.zeit ? k.clock.now() - lastRun.zeit : null;
  const jobRunning = isFresh(k, lastRun?.zeit);
  const catalogSub =
    openCatalog > 0
      ? `${openCatalog} Katalog-Bilder in Warteschlange` +
        (jobRunning
          ? ''
          : sinceRun === null
            ? ' · Job noch nicht gelaufen'
            : ` · seit ${Math.round(sinceRun / 60_000)} min kein Durchgang`)
      : null;
  const inventorySub =
    active > 0
      ? `${active} Bilder werden geladen`
      : open > 0
        ? `${open} Bilder noch nicht gecacht`
        : `Alle ${finished} Bilder gecacht`;
  const basisSub = catalogSub ? `Bestand: ${inventorySub} · ${catalogSub}` : inventorySub;
  const parts: SubPart[] = [
    {
      ...(active > 0
        ? part('images_loading', { n: active })
        : open > 0
          ? part('images_open', { n: open })
          : part('imgs_cached', { n: finished })),
      ...(openCatalog > 0 ? { ago: 'holding' as const } : {}),
    },
  ];
  if (openCatalog > 0) {
    parts.push(part('catalog_queue', { n: openCatalog }));
    if (!jobRunning)
      parts.push(sinceRun === null ? part('never_ran') : part('no_run', { min: Math.round(sinceRun / 60_000) }));
  }
  if (reDlRunning)
    parts.push(
      reDl?.phase === 'scanning'
        ? part('new_search')
        : part('reloaded', { n: reDl?.done || 0, total: reDl?.total || 0 }),
    );
  return {
    label: '📥 Bild-Download (CDN)',
    status:
      active > 0 || reDlRunning || (openCatalog > 0 && jobRunning)
        ? 'running'
        : open > 0 || openCatalog > 0
          ? 'idle'
          : 'done',
    sub: reDlSub ? `${basisSub} · ${reDlSub}` : basisSub,
    sub_parts: parts,
    // With the queue, otherwise the bar would stand at 100 % while images are pending.
    progress: finished,
    total: finished + open + openCatalog,
    queue: openCatalog,
    queueLastRun: lastRun?.zeit || null,
    lastRun: job?.lastRun || null,
    canRedownload: true,
  };
}

function pdfTile(): Tile {
  let inProgress = 0,
    finished = 0;
  try {
    for (const f of fs.readdirSync(PDF_JOB_DIR).filter((f: string) => f.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(PDF_JOB_DIR, f), 'utf8')) as { status?: string };
        if (j.status === 'running') inProgress++;
        else if (j.status === 'done') finished++;
      } catch (e) {
        reportError('admin:pdf-auftrag-lesen', e);
      }
    }
  } catch (e) {
    reportError('admin:auftragsordner-lesen', e);
  }
  return {
    label: '📄 PDF-Jobs',
    status: inProgress > 0 ? 'running' : finished > 0 ? 'idle' : 'done',
    progress: 0,
    total: 0,
    lastRun: null,
    sub:
      inProgress > 0
        ? `${inProgress} PDF(s) werden erstellt`
        : finished > 0
          ? `${finished} PDF(s) bereit zum Download`
          : 'Keine aktiven Jobs',
    sub_parts: [
      inProgress > 0
        ? part('pdf_running', { n: inProgress })
        : finished > 0
          ? part('pdf_ready', { n: finished })
          : part('no_active'),
    ],
  };
}

async function schedules(
  k: ManagementContext,
): Promise<Record<string, { type: string; time?: string; minutes?: number }>> {
  const from: Record<string, { type: string; time?: string; minutes?: number }> = {};
  for (const dj of DAILY_JOBS)
    from[dj.monitorKey] = {
      type: 'daily',
      time: (await k.settings.globalValue(`job_time_${dj.name}`)) || dj.default,
    };
  from.priceJob = {
    type: 'interval',
    minutes: parseInt((await k.settings.globalValue('price_job_interval_minutes')) || '60', 10),
  };
  return from;
}

/** Extended by numbers only the database knows; one function per tile. */
export async function jobMonitor(k: ManagementContext) {
  const jobs: Tiles = await tiles(k); // from laufzustand: the job process writes, reading happens here
  const ab = new Degradations();
  const [anleitungen, mapped, blTotal, rbParts, rbInventory, lastSync] = await Promise.all([
    instructionJobs(k, ab),
    count(ab, k.management.mappedParts(), 'bl_mapping'),
    count(ab, k.management.bricklinkParts(), 'bl_mapping'),
    count(ab, k.management.rbParts(), 'katalog'),
    count(ab, k.management.rbInventoryParts(), 'katalog'),
    k.jobQueue.readState('rb_csv_last_sync'),
  ]);
  const blIds = blIdsTile(jobs.blIds ?? {}, mapped, blTotal);
  if (blIds) jobs.blIds = blIds;
  const instruction = instructionsTile(jobs.instrQueue ?? {}, anleitungen);
  if (instruction) jobs.instrQueue = instruction;
  [jobs.bricksetRetry, jobs.imgDl] = await Promise.all([bricksetTile(k, ab), imageTile(k, ab)]);
  jobs.pdfJobs = pdfTile();
  return {
    jobs,
    schedules: await schedules(k),
    db: {
      instrQueue: { pending: anleitungen.open, done: anleitungen.done, failed: anleitungen.error },
      blMapping: { mapped: mapped, total: blTotal },
      csvCache: { parts: rbParts, inventoryParts: rbInventory, lastSync: lastSync || null },
    },
    ...ab.detail(),
  };
}
