/** Load the Rebrickable CSVs daily: the local catalog saves one API call
 * per display and the daily quota. */
import type { Payload, JobRun as CsvLauf } from '../jobQueue';
import { reloadBlNumbers } from './partsImport';
import { errorMessage, logAndContinue, withoutMissingFile } from '../infra/error';
import { rememberBlColorNumber, blColorNumberFrom } from './blMapping';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../infra/appPaths';
import { fork as _fork } from 'node:child_process';
import { attempts } from '../infra/result';
import type { CatalogContext } from './context';

const SYNC_KEY = 'rb_csv_last_sync';
const PART_CAT_KEY = 'rb_part_categories_last_sync';
const CATALOG_EXTRAS_KEY = 'rb_catalog_extras_last_sync';

function log(msg: string) {
  console.log(`[rb-csv-sync] ${msg}`);
}

/** The import runs in a process of its own; its entry point is execution and lives in jobs/,
 * the handler table passes its path in (jobs/startJobs.ts). */
type ImportProcess = string | null;

// Every file occupies a section of TOTAL_STEPS so that the bar
// grows continuously instead of jumping per file.
const TOTAL_STEPS = 8;
const DOWNLOAD_WEIGHT = 0.4;
function fileOverall(stepNum: number, phase: 'download' | 'import', pct: number) {
  const p = Math.max(0, Math.min(100, pct || 0)) / 100;
  const frac = phase === 'download' ? DOWNLOAD_WEIGHT * p : DOWNLOAD_WEIGHT + (1 - DOWNLOAD_WEIGHT) * p;
  return stepNum - 1 + frac;
}

function melder(kx: CatalogContext, lauf: CsvLauf) {
  return (step: string, progress: number, sub: string | null = null) => {
    void kx.jobQueue
      .reportStartState({ ready: false, step, progress, total: TOTAL_STEPS, sub })
      .catch(logAndContinue('rb-csv:start'));
    void lauf
      .progress?.({ erledigt: progress, gesamt: TOTAL_STEPS, text: sub, schritt: `CSV-Import: ${step}` })
      .catch(logAndContinue('rb-csv:stand'));
    if (!sub && !step.includes('k)')) log(step);
  };
}

async function runWorker(
  k: CatalogContext,
  lauf: CsvLauf,
  process: ImportProcess,
  task: string,
  stepNum: number,
  stepLabel: string,
  filename: string,
) {
  const report = melder(k, lauf);
  report(`${stepLabel} (Download...)`, fileOverall(stepNum, 'download', 0));
  const tmpFile = path.join(DATA_DIR, filename.replace('.gz', '.tmp'));
  let last = 0;
  try {
    await k.externalSources.quellen.loadCatalogCsv(filename, tmpFile, {
      ...(lauf.signal ? { signal: lauf.signal } : {}),
      atProgress: (bytes, total) => {
        if (k.uhr.jetzt() - last < 700) return;
        last = k.uhr.jetzt();
        const pct = total > 0 ? Math.round((bytes / total) * 100) : 0;
        report(
          `${stepLabel} (Download...)`,
          fileOverall(stepNum, 'download', pct),
          total > 0 ? `${pct}%` : `${(bytes / 1048576).toFixed(1)} MB`,
        );
      },
    });
    report(`${stepLabel} (Importiere...)`, fileOverall(stepNum, 'import', 0));
    return await importInWorker(k, lauf, process, task, stepNum, stepLabel);
  } finally {
    // Clean up — also on abort: inventory_parts.csv.tmp is about one gigabyte.
    await fs.promises.unlink(tmpFile).catch(withoutMissingFile('rb-csv:unlink'));
  }
}

function importInWorker(
  kx: CatalogContext,
  lauf: CsvLauf,
  _workerPath: ImportProcess,
  task: string,
  stepNum: number,
  stepLabel: string,
) {
  const report = melder(kx, lauf);
  return new Promise((resolve, reject) => {
    if (!_workerPath) {
      reject(new Error('Kein Importprozess eingesetzt (jobs/startJobs.ts)'));
      return;
    }
    const worker = _fork(_workerPath, [], { silent: false });
    const cancellation = () => {
      worker.kill();
      reject(lauf.signal?.reason ?? new Error('abgebrochen'));
    };
    lauf.signal?.addEventListener('abort', cancellation, { once: true });
    worker.on('message', (msg: { type?: string; pct?: number | null; total?: number; error?: string }) => {
      if (msg.type === 'progress') {
        const rowInfo = (msg.total ?? 0) > 0 ? ` (${((msg.total ?? 0) / 1000).toFixed(0)}k)` : '';
        report(
          `${stepLabel}${rowInfo}`,
          fileOverall(stepNum, 'import', msg.pct ?? 0),
          msg.pct != null ? `${msg.pct}%` : null,
        );
      } else if (msg.type === 'error') reject(new Error(msg.error));
      else if (msg.type === 'complete') resolve(undefined);
    });
    worker.on('error', reject);
    worker.on('exit', (code: number | null) => {
      lauf.signal?.removeEventListener('abort', cancellation);
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
    worker.send({ task });
  });
}

// Catch up if the main sync already ran today but these files are missing.
async function syncCatalogExtrasDaily(k: CatalogContext, lauf: CsvLauf, process: ImportProcess, today: string) {
  if ((await k.jobQueue.readState(CATALOG_EXTRAS_KEY)) === today) return;
  try {
    await runWorker(k, lauf, process, 'themes', TOTAL_STEPS, 'Themen laden...', 'themes.csv.gz');
    await runWorker(
      k,
      lauf,
      process,
      'inventory_minifigs',
      TOTAL_STEPS,
      'Inventar-Figuren laden...',
      'inventory_minifigs.csv.gz',
    );
    await k.jobQueue.setState(CATALOG_EXTRAS_KEY, today);
    log('catalog extras (themes + inventory_minifigs): Tagesimport erledigt');
  } catch (e) {
    if (lauf.signal?.aborted) throw e;
    log(`catalog extras: Tagesimport fehlgeschlagen: ${errorMessage(e)}`);
  }
}

// Daily even without a main sync, in case the file was added later.
async function syncPartCategoriesDaily(k: CatalogContext, lauf: CsvLauf, process: ImportProcess, today: string) {
  if ((await k.jobQueue.readState(PART_CAT_KEY)) === today) return;
  try {
    await runWorker(k, lauf, process, 'part_categories', TOTAL_STEPS, 'Kategorien laden...', 'part_categories.csv.gz');
    await k.jobQueue.setState(PART_CAT_KEY, today);
    log('part_categories: Tagesimport erledigt');
  } catch (e) {
    if (lauf.signal?.aborted) throw e;
    log(`part_categories: Tagesimport fehlgeschlagen: ${errorMessage(e)}`);
  }
}

const FILES: [string, string, string][] = [
  ['colors', 'Farben laden...', 'colors.csv.gz'],
  ['part_categories', 'Kategorien laden...', 'part_categories.csv.gz'],
  ['parts', 'Teile laden...', 'parts.csv.gz'],
  ['sets', 'Sets laden...', 'sets.csv.gz'],
  ['themes', 'Themen laden...', 'themes.csv.gz'],
  ['inventories', 'Inventare laden...', 'inventories.csv.gz'],
  ['inventory_parts', 'Inventar-Teile laden...', 'inventory_parts.csv.gz'],
  ['inventory_minifigs', 'Inventar-Figuren laden...', 'inventory_minifigs.csv.gz'],
];

async function loadEverything(kx: CatalogContext, lauf: CsvLauf, process: ImportProcess, today: string): Promise<void> {
  log(`Starting CSV sync for ${today}...`);
  try {
    for (const [i, [task, label, file]] of FILES.entries())
      await runWorker(kx, lauf, process, task, i + 1, label, file);
    // Written first, then "done today": otherwise a run whose marker is missing would count as finished.
    for (const k of [SYNC_KEY, PART_CAT_KEY, CATALOG_EXTRAS_KEY]) await kx.jobQueue.setState(k, today);
    log(`CSV sync complete for ${today}`);
  } catch (e) {
    log(`CSV sync failed: ${errorMessage(e)}`);
    // Without a catalog the app is usable; without this message the
    // start screen would stay. The job schedules the next attempt with backoff.
    await kx.jobQueue.reportStartState({
      ready: true,
      step: 'Katalog nicht geladen',
      progress: TOTAL_STEPS,
      total: TOTAL_STEPS,
    });
    throw e;
  }
}

async function loadBlColors(k: CatalogContext): Promise<void> {
  const key = await k.externalSources.quellen.getRbKey();
  if (!key) return;
  log('[colors] Fetching BrickLink color mapping from Rebrickable API…');
  let page = 1,
    count = 0,
    hasNext = true;
  while (hasNext) {
    // Without an answer the previous mapping stays; the next reconciliation tries again.
    const fetch = await attempts(
      'csv-abgleich:abruf',
      k.externalSources.quellen.httpsGetRobust(
        `https://rebrickable.com/api/v3/lego/colors/?page_size=200&page=${page}`,
        { Authorization: `key ${key}` },
        30000,
      ),
    );
    if (!fetch.ok || fetch.wert.status !== 200) break;
    const { body } = fetch.wert;
    const data = JSON.parse(body) as { results?: Record<string, unknown>[]; next?: string | null };
    for (const c of data.results || []) {
      const blId = blColorNumberFrom(c);
      if (blId != null) {
        await rememberBlColorNumber(k, Number(c.id), blId);
        count++;
      }
    }
    hasNext = !!data.next;
    page++;
  }
  log(`[colors] BrickLink color mapping: ${count} colors cached`);
}

async function run(k: CatalogContext, lauf: CsvLauf = {}, process: ImportProcess = null) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const today = k.uhr.datum().toISOString().slice(0, 10);
  if ((await k.jobQueue.readState(SYNC_KEY)) === today) {
    log(`Already synced today (${today}) — skipping CSV download`);
    await syncPartCategoriesDaily(k, lauf, process, today);
    await syncCatalogExtrasDaily(k, lauf, process, today);
    await k.jobQueue.reportStartState({
      ready: true,
      step: 'Bereit (Cache)',
      progress: TOTAL_STEPS,
      total: TOTAL_STEPS,
    });
  } else {
    await loadEverything(k, lauf, process, today);
  }
  await reloadBlNumbers(k, lauf).catch(logAndContinue('rb-csv:bl-nummern'));
  await k.jobQueue.reportStartState({ ready: true, step: 'Bereit', progress: TOTAL_STEPS, total: TOTAL_STEPS });
  log('Startup complete — server ready');
  await loadBlColors(k).catch(logAndContinue('rb-csv:bl-farben'));
}

/** At startup only if not loaded today yet; the daily run and the manually triggered one always load. */
async function csvReconcile(
  k: CatalogContext,
  n: Payload<'csv_sync'>,
  lauf: CsvLauf,
  process: ImportProcess = null,
): Promise<void> {
  if (!n.onStart) await k.jobQueue.deleteState(SYNC_KEY);
  await run(k, lauf, process);
}

export { run, csvReconcile };
