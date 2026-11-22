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
  const z = await ab.orElse('instructions', k.jobQueue.countKind('instructions'), null);
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
  const { waiting, due } = await ab.orElse('brickset', k.externalSources.brickset.numbers(), {
    waiting: 0,
    due: 0,
  });
  return {
    label: 'Brickset Retry Queue',
    status: waiting === 0 ? 'done' : 'idle',
    progress: 0,
    total: waiting,
    lastRun: null,
    sub:
      waiting === 0
        ? 'Keine ausstehenden Einträge'
        : due > 0
          ? `${due} Sets bereit zum Retry, ${waiting - due} warten`
          : `${waiting} Sets warten auf morgen`,
    sub_parts: [
      waiting === 0
        ? part('none_pending')
        : due > 0
          ? part('retry_ready', { n: due, w: waiting - due })
          : part('wait_tomorrow', { n: waiting }),
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

/** What the image tile counts; `sinceRun` null: the catalog job has not run yet. */
type ImageCounts = {
  open: number;
  finished: number;
  openCatalog: number;
  active: number;
  jobRunning: boolean;
  sinceRun: number | null;
};

function imageTileSub(c: ImageCounts): string {
  const waited =
    c.sinceRun === null
      ? ' · Job noch nicht gelaufen'
      : ` · seit ${Math.round(c.sinceRun / 60_000)} min kein Durchgang`;
  const catalogSub =
    c.openCatalog > 0 ? `${c.openCatalog} Katalog-Bilder in Warteschlange` + (c.jobRunning ? '' : waited) : null;
  const inventorySub =
    c.active > 0
      ? `${c.active} Bilder werden geladen`
      : c.open > 0
        ? `${c.open} Bilder noch nicht gecacht`
        : `Alle ${c.finished} Bilder gecacht`;
  return catalogSub ? `Bestand: ${inventorySub} · ${catalogSub}` : inventorySub;
}

function imageTileParts(c: ImageCounts): SubPart[] {
  const holding =
    c.active > 0
      ? part('images_loading', { n: c.active })
      : c.open > 0
        ? part('images_open', { n: c.open })
        : part('imgs_cached', { n: c.finished });
  const parts: SubPart[] = [{ ...holding, ...(c.openCatalog > 0 ? { ago: 'holding' as const } : {}) }];
  if (c.openCatalog > 0) {
    parts.push(part('catalog_queue', { n: c.openCatalog }));
    if (!c.jobRunning)
      parts.push(c.sinceRun === null ? part('never_ran') : part('no_run', { min: Math.round(c.sinceRun / 60_000) }));
  }
  return parts;
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
  const lastRun = await readRunState<{ time?: number }>(k, ab, 'imgqueue_last_run');
  const sinceRun = lastRun?.time ? k.clock.now() - lastRun.time : null;
  const jobRunning = isFresh(k, lastRun?.time);
  const counts = { open, finished, openCatalog, active, jobRunning, sinceRun };
  const basisSub = imageTileSub(counts);
  const parts = imageTileParts(counts);
  if (reDlRunning)
    parts.push(
      reDl?.phase === 'scanning'
        ? part('new_search')
        : part('reloaded', { n: reDl?.done || 0, total: reDl?.total || 0 }),
    );
  const running = active > 0 || reDlRunning || (openCatalog > 0 && jobRunning);
  return {
    label: '📥 Bild-Download (CDN)',
    status: running ? 'running' : open > 0 || openCatalog > 0 ? 'idle' : 'done',
    sub: reDlSub ? `${basisSub} · ${reDlSub}` : basisSub,
    sub_parts: parts,
    // With the queue, otherwise the bar would stand at 100 % while images are pending.
    progress: finished,
    total: finished + open + openCatalog,
    queue: openCatalog,
    queueLastRun: lastRun?.time || null,
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
  const [instructions, mapped, blTotal, rbParts, rbInventory, lastSync] = await Promise.all([
    instructionJobs(k, ab),
    count(ab, k.management.mappedParts(), 'bl_mapping'),
    count(ab, k.management.bricklinkParts(), 'bl_mapping'),
    count(ab, k.management.rbParts(), 'katalog'),
    count(ab, k.management.rbInventoryParts(), 'katalog'),
    k.jobQueue.readState('rb_csv_last_sync'),
  ]);
  const blIds = blIdsTile(jobs.blIds ?? {}, mapped, blTotal);
  if (blIds) jobs.blIds = blIds;
  const instruction = instructionsTile(jobs.instrQueue ?? {}, instructions);
  if (instruction) jobs.instrQueue = instruction;
  [jobs.bricksetRetry, jobs.imgDl] = await Promise.all([bricksetTile(k, ab), imageTile(k, ab)]);
  jobs.pdfJobs = pdfTile();
  return {
    jobs,
    schedules: await schedules(k),
    db: {
      instrQueue: { pending: instructions.open, done: instructions.done, failed: instructions.error },
      blMapping: { mapped: mapped, total: blTotal },
      csvCache: { parts: rbParts, inventoryParts: rbInventory, lastSync: lastSync || null },
    },
    ...ab.detail(),
  };
}
