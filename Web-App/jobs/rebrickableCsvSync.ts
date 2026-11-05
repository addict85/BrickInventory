'use strict';
/** Rebrickable-CSVs täglich laden: Der lokale Katalog spart je Anzeige einen
 * API-Abruf und das Tageskontingent.
 * Ausführlich: docs/begruendungen/jobs/rebrickableCsvSync.ts.md#abschnitt */
import { meldeStartZustand } from '../src/infra/startZustand';
import { fetchMissingBlIds } from '../src/katalog/partsImport';
import { getRbKey, httpsGetRobust } from '../clients/rebrickable';
import { fehlertext, logAndContinue, meldeUndLiefere, ohneFehlendeDatei } from '../src/infra/fehler';
import { merkeBlFarbnummer, blFarbnummerAus } from '../src/katalog/blZuordnung';
import { liesZustand, setzeZustand, loescheZustand } from '../src/auftraege/laufzustand';
import fs from 'fs';
import path from 'path';
import * as monitor from '../src/auftraege/jobMonitor';
import zlib2 from 'zlib';
import { DATA_DIR } from '../src/infra/appPaths';
import { fork as _fork } from 'child_process';
import { get } from 'https';

const CSV_BASE = 'https://cdn.rebrickable.com/media/downloads/';

const DOWNLOAD_IDLE_MS = 60000;


function updateStatus(step: string, progress: number, _total: number, sub: string | null = null) {
  const status = { ready: false, step, progress, total: TOTAL_STEPS, sub };
  void meldeStartZustand(status);
  monitor.update('csvImport', { status: 'running', progress, total: TOTAL_STEPS, sub, label: `CSV-Import: ${step}` });
  if (!sub && !step.includes('k)')) log(step);
}
const SYNC_KEY = 'rb_csv_last_sync';

function log(msg: string) { console.log(`[rb-csv-sync] ${msg}`); }


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

// Download im Hauptprozess, Import im Worker (isolierter Heap).
async function downloadToTmp(filename: string, stepLabel: string, stepNum: number) {
  const tmp = path.join(DATA_DIR, filename.replace('.gz', '.tmp'));
  await new Promise((resolve, reject) => {
        // Frist je Datenpaket, nicht für die Gesamtdauer: Eine hängende Verbindung
        // hielt sonst die Startanzeige ewig auf „Lade…", grosse Dateien dürfen laden.
    const req = get(`${CSV_BASE}${filename}`, { family: 4 }, (res: import('http').IncomingMessage) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${filename}`));
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0, lastTick = 0;
      res.on('data', chunk => {
        received += chunk.length;
        const now = Date.now();
        if (stepLabel && now - lastTick > 700) {
          lastTick = now;
          const bytesPct = totalBytes > 0 ? Math.round(received / totalBytes * 100) : 0;
          const sub = totalBytes > 0 ? `${bytesPct}%` : `${(received / 1048576).toFixed(1)} MB`;
          updateStatus(`${stepLabel} (Download...)`, fileOverall(stepNum, 'download', bytesPct), TOTAL_STEPS, sub);
        }
      });
      const out = fs.createWriteStream(tmp);
      res.pipe(zlib2.createGunzip()).pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(DOWNLOAD_IDLE_MS, () => {
      req.destroy(new Error(`Zeitüberschreitung beim Laden von ${filename} (${DOWNLOAD_IDLE_MS} ms ohne Daten)`));
    });
  });
  return tmp;
}

async function runWorker(task: string, stepNum: number, stepLabel: string, filename: string) {
  updateStatus(`${stepLabel} (Download...)`, fileOverall(stepNum, 'download', 0), TOTAL_STEPS);
  const tmpFile = await downloadToTmp(filename, stepLabel, stepNum);
  updateStatus(`${stepLabel} (Importiere...)`, fileOverall(stepNum, 'import', 0), TOTAL_STEPS);
  try {
    return await importInWorker(task, stepNum, stepLabel);
  } finally {
    // Aufräumen — auch bei Abbruch: inventory_parts.csv.tmp ist rund ein Gigabyte.
    fs.promises.unlink(tmpFile).catch(ohneFehlendeDatei('rb-csv:unlink'));
  }
}

function importInWorker(task: string, stepNum: number, stepLabel: string) {
  return new Promise((resolve, reject) => {
    const worker = _fork(_workerPath, [], { silent: false });
    worker.on('message', (msg: any) => {
      if (msg.type === 'progress') {
        const sub = msg.pct != null ? `${msg.pct}%` : null;
        const rowInfo = msg.total > 0 ? ` (${(msg.total/1000).toFixed(0)}k)` : '';
        updateStatus(`${stepLabel}${rowInfo}`, fileOverall(stepNum, 'import', msg.pct != null ? msg.pct : 0), TOTAL_STEPS, sub);
      } else if (msg.type === 'done') {
      } else if (msg.type === 'error') {
        reject(new Error(msg.error));
      } else if (msg.type === 'complete') {
        resolve(undefined);
      }
    });
    worker.on('error', reject);
    worker.on('exit', (code: number | null) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
    worker.send({ task });
  });
}

const PART_CAT_KEY = 'rb_part_categories_last_sync';
const CATALOG_EXTRAS_KEY = 'rb_catalog_extras_last_sync';

// Nachziehen, wenn der Haupt-Sync heute schon lief, diese Dateien aber fehlen.
async function syncCatalogExtrasDaily(today: string) {
  if (await liesZustand(CATALOG_EXTRAS_KEY) === today) return;
  try {
    await runWorker('themes',             TOTAL_STEPS, 'Themen laden...',           'themes.csv.gz');
    await runWorker('inventory_minifigs', TOTAL_STEPS, 'Inventar-Figuren laden...', 'inventory_minifigs.csv.gz');
    setzeZustand(CATALOG_EXTRAS_KEY, today);
    log('catalog extras (themes + inventory_minifigs): Tagesimport erledigt');
  } catch (e) {
    log(`catalog extras: Tagesimport fehlgeschlagen: ${fehlertext(e)}`);
  }
}

// Auch ohne Haupt-Sync täglich, falls die Datei nachträglich dazukam.
async function syncPartCategoriesDaily(today: string) {
  if (await liesZustand(PART_CAT_KEY) === today) return;
  try {
    await runWorker('part_categories', TOTAL_STEPS, 'Kategorien laden...', 'part_categories.csv.gz');
    setzeZustand(PART_CAT_KEY, today);
    log('part_categories: Tagesimport erledigt');
  } catch (e) {
    log(`part_categories: Tagesimport fehlgeschlagen: ${fehlertext(e)}`);
  }
}

async function run() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const lastSync = await liesZustand(SYNC_KEY);
  const today = new Date().toISOString().slice(0, 10);
  if (lastSync === today) {
    log(`Already synced today (${today}) — skipping CSV download`);
    await syncPartCategoriesDaily(today);
    await syncCatalogExtrasDaily(today);
    const s1 = { ready: true, step: 'Bereit (Cache)', progress: TOTAL_STEPS, total: TOTAL_STEPS };
    void meldeStartZustand(s1);
  } else {
    log(`Starting CSV sync for ${today}...`);
    try {
      await runWorker('colors',          1, 'Farben laden...',          'colors.csv.gz');
      await runWorker('part_categories', 2, 'Kategorien laden...',      'part_categories.csv.gz');
      await runWorker('parts',           3, 'Teile laden...',           'parts.csv.gz');
      await runWorker('sets',              4, 'Sets laden...',            'sets.csv.gz');
      await runWorker('themes',            5, 'Themen laden...',          'themes.csv.gz');
      await runWorker('inventories',       6, 'Inventare laden...',       'inventories.csv.gz');
      await runWorker('inventory_parts',   7, 'Inventar-Teile laden...',  'inventory_parts.csv.gz');
      await runWorker('inventory_minifigs',8, 'Inventar-Figuren laden...','inventory_minifigs.csv.gz');

      setzeZustand(SYNC_KEY, today);
      setzeZustand(PART_CAT_KEY, today);
      setzeZustand(CATALOG_EXTRAS_KEY, today);
      log(`CSV sync complete for ${today}`);
    } catch(e) {
      log(`CSV sync failed: ${fehlertext(e)}`);
      monitor.update('csvImport', { status: 'error', progress: 0, total: TOTAL_STEPS, sub: fehlertext(e) });
      // Ohne Katalog ist die App benutzbar; ohne diese Meldung bliebe der
      // Startbildschirm stehen. Den nächsten Versuch plant der Auftrag mit Backoff.
      const s0 = { ready: true, step: 'Katalog nicht geladen', progress: TOTAL_STEPS, total: TOTAL_STEPS };
      await meldeStartZustand(s0);
      throw e;
    }
  }

  try {
    await fetchMissingBlIds();
  } catch(e) { log(`fetchMissingBlIds error: ${fehlertext(e)}`); }

  const s2 = { ready: true, step: 'Bereit', progress: TOTAL_STEPS, total: TOTAL_STEPS };
  void meldeStartZustand(s2);
  monitor.update('csvImport', { status: 'done', progress: TOTAL_STEPS, total: TOTAL_STEPS, sub: null });
  log('Startup complete — server ready');

  // Die BrickLink-Farbzuordnung gibt es nur über die API, nicht als CSV.
  try {
    const key = await getRbKey().catch(meldeUndLiefere('rb-csv:getRbKey', null));
    if (key) {
      log('[colors] Fetching BrickLink color mapping from Rebrickable API…');
      let page = 1, count = 0, hasNext = true;
      while (hasNext) {
        const { status, body } = await httpsGetRobust(
          `https://rebrickable.com/api/v3/lego/colors/?page_size=200&page=${page}`,
          { Authorization: `key ${key}` }, 30000
        ).catch(() => ({ status: 0, body: '' }));
        if (status !== 200) break;
        const data = JSON.parse(body);
        for (const c of (data.results || [])) {
          const blId = blFarbnummerAus(c);
          if (blId != null) {
            await merkeBlFarbnummer(c.id, blId).catch(logAndContinue('rb-csv:merkeBlFarbnummer'));
            count++;
          }
        }
        hasNext = !!data.next;
        page++;
      }
      log(`[colors] BrickLink color mapping: ${count} colors cached`);
    }
  } catch(e) {
    log(`[colors] BrickLink color mapping fetch failed: ${fehlertext(e)}`);
  }
}

/** Beim Start nur, wenn heute noch nicht geladen; der tägliche und der von
 * Hand angestossene Lauf laden immer. */
async function csvAbgleich(n: Record<string, unknown>): Promise<void> {
  if (!n.beimStart) await loescheZustand(SYNC_KEY);
  await run();
}

export { run, csvAbgleich };