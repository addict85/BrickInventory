/** Rebrickable-CSVs täglich laden: Der lokale Katalog spart je Anzeige einen
 * API-Abruf und das Tageskontingent. Ausführlich: docs/begruendungen/jobs/rebrickableCsvSync.ts.md#abschnitt */
import { meldeStartZustand } from '../src/auftraege/startZustand';
import { fetchMissingBlIds } from '../src/katalog/partsImport';
import { getRbKey, httpsGetRobust, ladeKatalogCsv } from '../src/katalog/quellen';
import { einzeilig, fehlertext, logAndContinue, meldeUndLiefere, ohneFehlendeDatei } from '../src/infra/fehler';
import { merkeBlFarbnummer, blFarbnummerAus } from '../src/katalog/blZuordnung';
import { liesZustand, setzeZustand, loescheZustand } from '../src/auftraege/laufzustand';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../src/infra/appPaths';
import { fork as _fork } from 'child_process';
import type { Nutzlast } from '../src/auftraege/nutzlasten';
import type { AuftragsLauf as CsvLauf } from '../src/auftraege/auftraege';

const SYNC_KEY = 'rb_csv_last_sync';
const PART_CAT_KEY = 'rb_part_categories_last_sync';
const CATALOG_EXTRAS_KEY = 'rb_catalog_extras_last_sync';

function log(msg: string) { console.log(einzeilig(`[rb-csv-sync] ${msg}`)); }

// __dirname ist hier RICHTIG: Der Worker liegt neben dieser Datei, ob aus den
// Quellen oder aus dist/; ein Pfad über die Wurzel träfe dort nichts.
const _workerPath = path.join(__dirname, 'csvImportWorker.js');

// Jede Datei belegt einen Abschnitt von TOTAL_STEPS, damit der Balken
// durchgehend wächst statt je Datei zu springen.
const TOTAL_STEPS = 8;
const DOWNLOAD_WEIGHT = 0.4;
function fileOverall(stepNum: number, phase: 'download' | 'import', pct: number) {
  const p = Math.max(0, Math.min(100, pct || 0)) / 100;
  const frac = phase === 'download'
    ? DOWNLOAD_WEIGHT * p
    : DOWNLOAD_WEIGHT + (1 - DOWNLOAD_WEIGHT) * p;
  return (stepNum - 1) + frac;
}

function melder(lauf: CsvLauf) {
  return (step: string, progress: number, sub: string | null = null) => {
    void meldeStartZustand({ ready: false, step, progress, total: TOTAL_STEPS, sub }).catch(logAndContinue('rb-csv:start'));
    void lauf.fortschritt?.({ erledigt: progress, gesamt: TOTAL_STEPS, text: sub, schritt: `CSV-Import: ${step}` })
      .catch(logAndContinue('rb-csv:stand'));
    if (!sub && !step.includes('k)')) log(step);
  };
}

async function runWorker(lauf: CsvLauf, task: string, stepNum: number, stepLabel: string, filename: string) {
  const melde = melder(lauf);
  melde(`${stepLabel} (Download...)`, fileOverall(stepNum, 'download', 0));
  const tmpFile = path.join(DATA_DIR, filename.replace('.gz', '.tmp'));
  let letzter = 0;
  try {
    await ladeKatalogCsv(filename, tmpFile, {
      ...(lauf.signal ? { signal: lauf.signal } : {}),
      beiFortschritt: (bytes, gesamt) => {
        if (Date.now() - letzter < 700) return;
        letzter = Date.now();
        const pct = gesamt > 0 ? Math.round(bytes / gesamt * 100) : 0;
        melde(`${stepLabel} (Download...)`, fileOverall(stepNum, 'download', pct),
          gesamt > 0 ? `${pct}%` : `${(bytes / 1048576).toFixed(1)} MB`);
      },
    });
    melde(`${stepLabel} (Importiere...)`, fileOverall(stepNum, 'import', 0));
    return await importInWorker(lauf, task, stepNum, stepLabel);
  } finally {
    // Aufräumen — auch bei Abbruch: inventory_parts.csv.tmp ist rund ein Gigabyte.
    await fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('rb-csv:unlink'));
  }
}

function importInWorker(lauf: CsvLauf, task: string, stepNum: number, stepLabel: string) {
  const melde = melder(lauf);
  return new Promise((resolve, reject) => {
    const worker = _fork(_workerPath, [], { silent: false });
    const abbruch = () => { worker.kill(); reject(lauf.signal?.reason ?? new Error('abgebrochen')); };
    lauf.signal?.addEventListener('abort', abbruch, { once: true });
    worker.on('message', (msg: { type?: string; pct?: number | null; total?: number; error?: string }) => {
      if (msg.type === 'progress') {
        const rowInfo = (msg.total ?? 0) > 0 ? ` (${((msg.total ?? 0) / 1000).toFixed(0)}k)` : '';
        melde(`${stepLabel}${rowInfo}`, fileOverall(stepNum, 'import', msg.pct ?? 0), msg.pct != null ? `${msg.pct}%` : null);
      } else if (msg.type === 'error') reject(new Error(msg.error));
      else if (msg.type === 'complete') resolve(undefined);
    });
    worker.on('error', reject);
    worker.on('exit', (code: number | null) => {
      lauf.signal?.removeEventListener('abort', abbruch);
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
    worker.send({ task });
  });
}

// Nachziehen, wenn der Haupt-Sync heute schon lief, diese Dateien aber fehlen.
async function syncCatalogExtrasDaily(lauf: CsvLauf, today: string) {
  if (await liesZustand(CATALOG_EXTRAS_KEY) === today) return;
  try {
    await runWorker(lauf, 'themes',             TOTAL_STEPS, 'Themen laden...',           'themes.csv.gz');
    await runWorker(lauf, 'inventory_minifigs', TOTAL_STEPS, 'Inventar-Figuren laden...', 'inventory_minifigs.csv.gz');
    await setzeZustand(CATALOG_EXTRAS_KEY, today);
    log('catalog extras (themes + inventory_minifigs): Tagesimport erledigt');
  } catch (e) {
    if (lauf.signal?.aborted) throw e;
    log(`catalog extras: Tagesimport fehlgeschlagen: ${fehlertext(e)}`);
  }
}

// Auch ohne Haupt-Sync täglich, falls die Datei nachträglich dazukam.
async function syncPartCategoriesDaily(lauf: CsvLauf, today: string) {
  if (await liesZustand(PART_CAT_KEY) === today) return;
  try {
    await runWorker(lauf, 'part_categories', TOTAL_STEPS, 'Kategorien laden...', 'part_categories.csv.gz');
    await setzeZustand(PART_CAT_KEY, today);
    log('part_categories: Tagesimport erledigt');
  } catch (e) {
    if (lauf.signal?.aborted) throw e;
    log(`part_categories: Tagesimport fehlgeschlagen: ${fehlertext(e)}`);
  }
}

const DATEIEN: [string, string, string][] = [
  ['colors', 'Farben laden...', 'colors.csv.gz'],
  ['part_categories', 'Kategorien laden...', 'part_categories.csv.gz'],
  ['parts', 'Teile laden...', 'parts.csv.gz'],
  ['sets', 'Sets laden...', 'sets.csv.gz'],
  ['themes', 'Themen laden...', 'themes.csv.gz'],
  ['inventories', 'Inventare laden...', 'inventories.csv.gz'],
  ['inventory_parts', 'Inventar-Teile laden...', 'inventory_parts.csv.gz'],
  ['inventory_minifigs', 'Inventar-Figuren laden...', 'inventory_minifigs.csv.gz'],
];

async function ladeAlles(lauf: CsvLauf, today: string): Promise<void> {
  log(`Starting CSV sync for ${today}...`);
  try {
    for (const [i, [task, label, datei]] of DATEIEN.entries()) await runWorker(lauf, task, i + 1, label, datei);
    // Erst geschrieben, dann „heute erledigt“: Sonst gälte ein Lauf als fertig, dessen Marke fehlt.
    for (const k of [SYNC_KEY, PART_CAT_KEY, CATALOG_EXTRAS_KEY]) await setzeZustand(k, today);
    log(`CSV sync complete for ${today}`);
  } catch (e) {
    log(`CSV sync failed: ${fehlertext(e)}`);
    // Ohne Katalog ist die App benutzbar; ohne diese Meldung bliebe der
    // Startbildschirm stehen. Den nächsten Versuch plant der Auftrag mit Backoff.
    await meldeStartZustand({ ready: true, step: 'Katalog nicht geladen', progress: TOTAL_STEPS, total: TOTAL_STEPS });
    throw e;
  }
}

async function ladeBlFarben(): Promise<void> {
  const key = await getRbKey().catch(meldeUndLiefere('rb-csv:getRbKey', null));
  if (!key) return;
  log('[colors] Fetching BrickLink color mapping from Rebrickable API…');
  let page = 1, count = 0, hasNext = true;
  while (hasNext) {
    const { status, body } = await httpsGetRobust(
      `https://rebrickable.com/api/v3/lego/colors/?page_size=200&page=${page}`,
      { Authorization: `key ${key}` }, 30000,
    ).catch(meldeUndLiefere('csv-abgleich:abruf', { status: 0, body: '' }));
    if (status !== 200) break;
    const data = JSON.parse(body) as { results?: Record<string, unknown>[]; next?: string | null };
    for (const c of (data.results || [])) {
      const blId = blFarbnummerAus(c);
      if (blId != null) {
        await merkeBlFarbnummer(Number(c.id), blId).catch(logAndContinue('rb-csv:merkeBlFarbnummer'));
        count++;
      }
    }
    hasNext = !!data.next;
    page++;
  }
  log(`[colors] BrickLink color mapping: ${count} colors cached`);
}

async function run(lauf: CsvLauf = {}) {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  if (await liesZustand(SYNC_KEY) === today) {
    log(`Already synced today (${today}) — skipping CSV download`);
    await syncPartCategoriesDaily(lauf, today);
    await syncCatalogExtrasDaily(lauf, today);
    await meldeStartZustand({ ready: true, step: 'Bereit (Cache)', progress: TOTAL_STEPS, total: TOTAL_STEPS });
  } else {
    await ladeAlles(lauf, today);
  }
  await fetchMissingBlIds(lauf).catch(logAndContinue('rb-csv:bl-nummern'));
  await meldeStartZustand({ ready: true, step: 'Bereit', progress: TOTAL_STEPS, total: TOTAL_STEPS });
  log('Startup complete — server ready');
  await ladeBlFarben().catch(logAndContinue('rb-csv:bl-farben'));
}

/** Beim Start nur, wenn heute noch nicht geladen; der tägliche und der von
 * Hand angestossene Lauf laden immer. */
async function csvAbgleich(n: Nutzlast<'csv_sync'>, lauf: CsvLauf): Promise<void> {
  if (!n.beimStart) await loescheZustand(SYNC_KEY);
  await run(lauf);
}

export { run, csvAbgleich };
