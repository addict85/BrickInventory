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
type SubPart = { code: string; werte?: Record<string, number | string>; vor?: 'bestand' };

const part = (code: string, werte?: Record<string, number | string>): SubPart => (werte ? { code, werte } : { code });

type Tiles = Record<string, Tile>;

const count = (ab: Degradations, p: Promise<number>, ort: string) => ab.oder(ort, p, 0);

/** A JSON state from laufzustand; a damaged one counts as none. */
async function readState<T>(k: ManagementContext, ab: Degradations, schluessel: string): Promise<T | null> {
  const roh = await ab.oder(schluessel, k.jobQueue.liesZustand(schluessel), null);
  try {
    return roh ? (JSON.parse(roh) as T) : null;
  } catch {
    return null;
  }
}

function blIdsTile(alt: Tile, gemappt: number, gesamt: number): Tile | null {
  if (gesamt <= 0) return null;
  return {
    ...alt,
    status: gemappt < gesamt ? (alt.status === 'running' ? 'running' : 'idle') : 'done',
    progress: gemappt,
    total: gesamt,
    sub: gemappt < gesamt ? `${gemappt} / ${gesamt} gemappt` : `Alle ${gesamt} gemappt`,
    sub_teile: [gemappt < gesamt ? part('teil_gemappt', { n: gemappt, gesamt }) : part('all_mapped', { n: gesamt })],
  };
}

/** Counted once: open, done and failed from the same query. */
async function instructionJobs(k: ManagementContext, ab: Degradations) {
  const z = await ab.oder('anleitungen', k.jobQueue.countKind('anleitung'), null);
  return { offen: z ? z.offen + z.laeuft : 0, erledigt: z?.erledigt ?? 0, fehler: z?.fehler ?? 0 };
}

function instructionsTile(alt: Tile, a: { offen: number; erledigt: number; fehler: number }): Tile | null {
  const gesamt = a.offen + a.erledigt + a.fehler;
  if (gesamt <= 0) return null;
  return {
    ...alt,
    status: a.offen > 0 ? 'running' : 'done',
    progress: a.erledigt,
    total: gesamt,
    sub: a.offen > 0 ? `${a.offen} ausstehend` : 'Alle erledigt',
    sub_teile: [a.offen > 0 ? part('ausstehend', { n: a.offen }) : part('all_done')],
  };
}

async function bricksetTile(k: ManagementContext, ab: Degradations): Promise<Tile> {
  const { wartend, faellig } = await ab.oder('brickset', k.externalSources.brickset.zahlen(), {
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
    sub_teile: [
      wartend === 0
        ? part('keine_ausstehenden')
        : faellig > 0
          ? part('retry_ready', { n: faellig, w: wartend - faellig })
          : part('warten_morgen', { n: wartend }),
    ],
  };
}

/** "running" means: has done something RECENTLY (timestamp of the state). */
const isFresh = (k: ManagementContext, zeit: unknown) =>
  typeof zeit === 'number' && k.uhr.jetzt() - zeit < JOB_FRESH_MS;

/** Inventory, reloading and catalog in ONE tile, otherwise it would report "all cached"
 * while the background job is reloading. */
/** Capped to the really open images: that heals an orphaned counter after a crash. */
async function imagesInProgress(k: ManagementContext, ab: Degradations, offen: number): Promise<number> {
  const aktiv = await ab.oder('bilder', imgDlPending(k), 0);
  if (offen === 0 && aktiv > 0) {
    await imgDlReset(k);
    return 0;
  }
  return Math.min(aktiv, offen);
}

async function redownloadState(k: ManagementContext, ab: Degradations) {
  const reDl = await readState<{ running?: boolean; at?: number; phase?: string; done?: number; total?: number }>(
    k,
    ab,
    'imgredl_status',
  );
  const laeuft = reDl?.running === true && (typeof reDl.at !== 'number' || isFresh(k, reDl.at));
  const sub = !laeuft
    ? null
    : reDl?.phase === 'scanning'
      ? '↻ suche fehlende Bilder…'
      : `↻ ${reDl?.done || 0}/${reDl?.total || 0} fehlende neu geladen`;
  return { reDl, laeuft, sub };
}

async function imageTile(k: ManagementContext, ab: Degradations): Promise<Tile> {
  const [openParts, fertig, setMinifigs, inventoryMinifigs, openCatalog] = await Promise.all([
    count(ab, k.management.partImagesOpen(), 'bilder'),
    count(ab, k.management.partImagesDone(), 'bilder'),
    count(ab, k.management.setMinifigImagesOpen(), 'bilder'),
    // Figures of the inventory are stored locally by the same run; they belong to the open set.
    count(ab, k.management.holdingMinifigImagesOpen(), 'bilder'),
    count(ab, k.management.catalogImagesOpen(), 'bilder'),
  ]);
  const offen = openParts + setMinifigs + inventoryMinifigs;
  const job = await ab.oder('bilder', tile(k, 'imgDl'), null);
  const aktiv = await imagesInProgress(k, ab, offen);
  const { reDl, laeuft: reDlRunning, sub: reDlSub } = await redownloadState(k, ab);
  // "running" means: has recently done something, according to the database.
  const letzterLauf = await readState<{ zeit?: number }>(k, ab, 'imgqueue_last_run');
  const sinceRun = letzterLauf?.zeit ? k.uhr.jetzt() - letzterLauf.zeit : null;
  const jobRunning = isFresh(k, letzterLauf?.zeit);
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
    aktiv > 0
      ? `${aktiv} Bilder werden geladen`
      : offen > 0
        ? `${offen} Bilder noch nicht gecacht`
        : `Alle ${fertig} Bilder gecacht`;
  const basisSub = catalogSub ? `Bestand: ${inventorySub} · ${catalogSub}` : inventorySub;
  const teile: SubPart[] = [
    {
      ...(aktiv > 0
        ? part('bilder_laden', { n: aktiv })
        : offen > 0
          ? part('bilder_offen', { n: offen })
          : part('imgs_cached', { n: fertig })),
      ...(openCatalog > 0 ? { vor: 'bestand' as const } : {}),
    },
  ];
  if (openCatalog > 0) {
    teile.push(part('katalog_warteschlange', { n: openCatalog }));
    if (!jobRunning)
      teile.push(sinceRun === null ? part('job_nie') : part('kein_durchgang', { min: Math.round(sinceRun / 60_000) }));
  }
  if (reDlRunning)
    teile.push(
      reDl?.phase === 'scanning'
        ? part('neu_suche')
        : part('neu_geladen', { n: reDl?.done || 0, gesamt: reDl?.total || 0 }),
    );
  return {
    label: '📥 Bild-Download (CDN)',
    status:
      aktiv > 0 || reDlRunning || (openCatalog > 0 && jobRunning)
        ? 'running'
        : offen > 0 || openCatalog > 0
          ? 'idle'
          : 'done',
    sub: reDlSub ? `${basisSub} · ${reDlSub}` : basisSub,
    sub_teile: teile,
    // With the queue, otherwise the bar would stand at 100 % while images are pending.
    progress: fertig,
    total: fertig + offen + openCatalog,
    queue: openCatalog,
    queueLastRun: letzterLauf?.zeit || null,
    lastRun: job?.lastRun || null,
    canRedownload: true,
  };
}

function pdfTile(): Tile {
  let laufend = 0,
    fertig = 0;
  try {
    for (const f of fs.readdirSync(PDF_JOB_DIR).filter((f: string) => f.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(PDF_JOB_DIR, f), 'utf8')) as { status?: string };
        if (j.status === 'running') laufend++;
        else if (j.status === 'done') fertig++;
      } catch (e) {
        reportError('admin:pdf-auftrag-lesen', e);
      }
    }
  } catch (e) {
    reportError('admin:auftragsordner-lesen', e);
  }
  return {
    label: '📄 PDF-Jobs',
    status: laufend > 0 ? 'running' : fertig > 0 ? 'idle' : 'done',
    progress: 0,
    total: 0,
    lastRun: null,
    sub:
      laufend > 0
        ? `${laufend} PDF(s) werden erstellt`
        : fertig > 0
          ? `${fertig} PDF(s) bereit zum Download`
          : 'Keine aktiven Jobs',
    sub_teile: [
      laufend > 0
        ? part('pdf_laufend', { n: laufend })
        : fertig > 0
          ? part('pdf_bereit', { n: fertig })
          : part('no_active'),
    ],
  };
}

async function zeitplaene(
  k: ManagementContext,
): Promise<Record<string, { type: string; time?: string; minutes?: number }>> {
  const aus: Record<string, { type: string; time?: string; minutes?: number }> = {};
  for (const dj of DAILY_JOBS)
    aus[dj.monitorKey] = {
      type: 'daily',
      time: (await k.settings.globalValue(`job_time_${dj.name}`)) || dj.default,
    };
  aus.priceJob = {
    type: 'interval',
    minutes: parseInt((await k.settings.globalValue('price_job_interval_minutes')) || '60', 10),
  };
  return aus;
}

/** Extended by numbers only the database knows; one function per tile. */
export async function jobMonitor(k: ManagementContext) {
  const jobs: Tiles = await tiles(k); // from laufzustand: the job process writes, reading happens here
  const ab = new Degradations();
  const [anleitungen, gemappt, blTotal, rbParts, rbInventory, lastSync] = await Promise.all([
    instructionJobs(k, ab),
    count(ab, k.management.mappedParts(), 'bl_mapping'),
    count(ab, k.management.bricklinkParts(), 'bl_mapping'),
    count(ab, k.management.rbParts(), 'katalog'),
    count(ab, k.management.rbInventoryParts(), 'katalog'),
    k.jobQueue.liesZustand('rb_csv_last_sync'),
  ]);
  const blIds = blIdsTile(jobs.blIds ?? {}, gemappt, blTotal);
  if (blIds) jobs.blIds = blIds;
  const anleitung = instructionsTile(jobs.instrQueue ?? {}, anleitungen);
  if (anleitung) jobs.instrQueue = anleitung;
  [jobs.bricksetRetry, jobs.imgDl] = await Promise.all([bricksetTile(k, ab), imageTile(k, ab)]);
  jobs.pdfJobs = pdfTile();
  return {
    jobs,
    schedules: await zeitplaene(k),
    db: {
      instrQueue: { pending: anleitungen.offen, done: anleitungen.erledigt, failed: anleitungen.fehler },
      blMapping: { mapped: gemappt, total: blTotal },
      csvCache: { parts: rbParts, inventoryParts: rbInventory, lastSync: lastSync || null },
    },
    ...ab.angabe(),
  };
}
