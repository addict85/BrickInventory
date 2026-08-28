'use strict';
/**
 * Downloads Rebrickable CSV files daily and imports them into local DB tables.
 * CSVs used:
 *   parts.csv          — part_num, name, part_cat_id, part_url, part_img_url, print_of
 *   colors.csv         — id, name, rgb, is_trans
 *   inventories.csv    — id, set_num, version
 *   inventory_parts.csv— inventory_id, part_num, color_id, quantity, is_spare, img_url
 *   sets.csv           — set_num, name, year, theme_id, num_parts, set_img_url
 *
 * Der Download läuft hier im Hauptprozess, der Import in einem geforkten
 * jobs/csvImportWorker.ts (eigener Heap). Die BrickLink-Nummern zieht
 * jobs/backfillBlPartNumbers.ts nach.
 */
// Pfade zentral auflösen — __dirname zeigt seit dem dist/-Build nicht mehr
// auf die Wurzel. Siehe utils/appPaths.ts.
const { APP_ROOT, DATA_DIR, PUBLIC_DIR } = require('../utils/appPaths');
import { fetchMissingBlIds } from '../routes/parts';
import { getRbKey, httpsGetRobust } from '../clients/rebrickable';
const fs       = require('fs');
const path     = require('path');
const db       = require('../db/database');

const CSV_BASE = 'https://cdn.rebrickable.com/media/downloads/';

/** Frist ohne empfangene Daten, nach der ein CSV-Download abgebrochen wird. */
const DOWNLOAD_IDLE_MS = 60000;

// Global startup status — read by /api/startup-status
// Only initialize if not already set by server.js
if (!global.startupStatus) global.startupStatus = { ready: false, step: 'Starte...', progress: 0, total: 8 };
const monitor = require('../utils/jobMonitor');

function updateStatus(step, progress, total, sub = null) {
  const status = { ready: false, step, progress, total: TOTAL_STEPS, sub };
  global.startupStatus = status;
  // Write to PostgreSQL so all cluster workers see the same status
  db.run(
    `INSERT INTO global_settings (key,value) VALUES ('startup_status',$1)
     ON CONFLICT (key) DO UPDATE SET value=$1`,
    [JSON.stringify(status)]
  ).catch(() => {});
  monitor.update('csvImport', { status: 'running', progress, total: TOTAL_STEPS, sub, label: `CSV-Import: ${step}` });
  // Only log step changes, not progress updates
  if (!sub && !step.includes('k)')) log(step);
}
const CSV_CACHE_DIR = path.join(DATA_DIR, 'csv_cache');
const SYNC_KEY = 'rb_csv_last_sync';

function log(msg) { console.log(`[rb-csv-sync] ${msg}`); }

// ── Schema ────────────────────────────────────────────────────────────────────
async function ensureSchema() {
  await db.run(`CREATE TABLE IF NOT EXISTS rb_parts (
    part_num   TEXT PRIMARY KEY,
    name       TEXT,
    part_cat_id INTEGER,
    part_img_url TEXT
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS rb_colors (
    id    INTEGER PRIMARY KEY,
    name  TEXT,
    rgb   TEXT,
    is_trans TEXT,
    bl_color_id INTEGER
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS rb_part_categories (
    id   INTEGER PRIMARY KEY,
    name TEXT
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS rb_inventories (
    id      INTEGER PRIMARY KEY,
    set_num TEXT,
    version INTEGER
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS rb_inventory_parts (
    id           SERIAL PRIMARY KEY,
    inventory_id INTEGER NOT NULL,
    part_num     TEXT NOT NULL,
    color_id     INTEGER,
    quantity     INTEGER,
    is_spare     TEXT,
    img_url      TEXT
  )`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_rb_inv_parts_set ON rb_inventory_parts(inventory_id)`);
  await db.run(`CREATE TABLE IF NOT EXISTS rb_sets (
    set_num     TEXT PRIMARY KEY,
    name        TEXT,
    year        INTEGER,
    theme_id    INTEGER,
    num_parts   INTEGER,
    set_img_url TEXT
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS rb_bl_mapping (
    part_num    TEXT PRIMARY KEY,
    bl_part_num TEXT,
    fetched_at  TIMESTAMPTZ DEFAULT NOW()
  )`);
  // ── Katalog-Erweiterung: Themes (Kategorien) + Minifiguren pro Inventar ──
  await db.run(`CREATE TABLE IF NOT EXISTS rb_themes (
    id        INTEGER PRIMARY KEY,
    name      TEXT,
    parent_id INTEGER
  )`);
  await db.run(`CREATE TABLE IF NOT EXISTS rb_inventory_minifigs (
    id           SERIAL PRIMARY KEY,
    inventory_id INTEGER NOT NULL,
    fig_num      TEXT NOT NULL,
    quantity     INTEGER
  )`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_rb_inv_minifigs_inv ON rb_inventory_minifigs(inventory_id)`);
  // Indexe fuer Katalog-Browsing (Filter nach Theme/Jahr auf ~25k Sets)
  await db.run(`CREATE INDEX IF NOT EXISTS idx_rb_sets_theme ON rb_sets(theme_id)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_rb_sets_year  ON rb_sets(year)`);
}

// ── Download & parse gzipped CSV ─────────────────────────────────────────────
// Hier standen downloadCsv() und streamCsvToDB() — zwei vollständige
// Zweitfassungen des CSV-Wegs samt eigener parseCsvLine(). Aufgerufen hat sie
// niemand: Der Live-Weg läuft über downloadToTmp() und den geforkten
// jobs/csvImportWorker.ts. Entfallen, damit es nur noch EINE Fassung gibt.

// ── Import CSVs into DB ───────────────────────────────────────────────────────

// fetchBlIds() stand hier: der Batch-Abruf der BrickLink-Nummern über die
// Rebrickable-API. Aufgerufen wurde er nirgends — diese Aufgabe erledigt
// jobs/backfillBlPartNumbers.ts, das dieselbe Tabelle (rb_bl_mapping) füllt und
// vom Tagesplaner gestartet wird. Entfallen.

// ── Main run ──────────────────────────────────────────────────────────────────
// ── CSV-Import-Helfer (Modulebene, damit auch der Skip-Zweig sie nutzen kann) ──
const { fork: _fork } = require('child_process');
// __dirname ist hier RICHTIG und darf nicht durch appPaths ersetzt werden:
// Der Worker liegt neben dieser Datei, egal ob der Code aus den Quellen oder
// aus dist/ läuft. Ein Pfad über die Wurzel würde bei laufendem dist/-Build
// auf jobs/csvImportWorker.js zeigen — eine Datei, die dort nicht mehr liegt.
const _workerPath = path.join(__dirname, 'csvImportWorker.js');

// Kontinuierlicher Gesamtfortschritt: jedes File belegt den Slice
// [stepNum-1, stepNum] von TOTAL_STEPS. Innerhalb eines Files verteilt sich der
// Fortschritt auf Download (0..DOWNLOAD_WEIGHT) und Import (DOWNLOAD_WEIGHT..1),
// sodass der Balken NICHT pro File springt, sondern durchgehend waechst.
const TOTAL_STEPS = 8;
const DOWNLOAD_WEIGHT = 0.4;
function fileOverall(stepNum, phase, pct) {
  const p = Math.max(0, Math.min(100, pct || 0)) / 100;
  const frac = phase === 'download'
    ? DOWNLOAD_WEIGHT * p
    : DOWNLOAD_WEIGHT + (1 - DOWNLOAD_WEIGHT) * p;
  return (stepNum - 1) + frac;
}

// Download im Hauptprozess (Netzwerkzugriff), Import im Worker (isolierter Heap)
async function downloadToTmp(filename, stepLabel, stepNum) {
  const tmp = path.join(DATA_DIR, filename.replace('.gz', '.tmp'));
  await new Promise((resolve, reject) => {
    const { get } = require('https');
    const zlib2 = require('zlib');
    // Zeitlimit: Ohne dieses blieb eine hängende CDN-Verbindung für immer
    // stehen — und weil der Abgleich beim Erststart läuft, blieb die
    // Startanzeige ewig auf „Lade…". Die API-Aufrufe weiter unten hatten seit
    // jeher 30 s, dieser Weg nicht. Die Frist gilt je Datenpaket (setTimeout
    // auf der Anfrage misst Untätigkeit), nicht für die Gesamtdauer — grosse
    // Dateien dürfen also beliebig lange laden, solange etwas ankommt.
    const req = get(`${CSV_BASE}${filename}`, { family: 4 }, res => {
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

async function runWorker(task, stepNum, stepLabel, filename) {
  updateStatus(`${stepLabel} (Download...)`, fileOverall(stepNum, 'download', 0), TOTAL_STEPS);
  const tmpFile = await downloadToTmp(filename, stepLabel, stepNum);
  updateStatus(`${stepLabel} (Importiere...)`, fileOverall(stepNum, 'import', 0), TOTAL_STEPS);
  try {
    return await importInWorker(task, stepNum, stepLabel);
  } finally {
    // Aufräumen — auch bei Abbruch. Vorher löschte NIEMAND die entpackten
    // Zwischendateien: inventory_parts.csv.tmp liegt bei rund einem Gigabyte
    // und blieb nach jedem Lauf dauerhaft in data/ stehen.
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

function importInWorker(task, stepNum, stepLabel) {
  return new Promise((resolve, reject) => {
    const worker = _fork(_workerPath, [], { env: process.env, silent: false });
    worker.on('message', (/** @type {any} */ msg) => {
      if (msg.type === 'progress') {
        const sub = msg.pct != null ? `${msg.pct}%` : null;
        const rowInfo = msg.total > 0 ? ` (${(msg.total/1000).toFixed(0)}k)` : '';
        updateStatus(`${stepLabel}${rowInfo}`, fileOverall(stepNum, 'import', msg.pct != null ? msg.pct : 0), TOTAL_STEPS, sub);
      } else if (msg.type === 'done') {
        // silent
      } else if (msg.type === 'error') {
        reject(new Error(msg.error));
      } else if (msg.type === 'complete') {
        resolve(undefined);
      }
    });
    worker.on('error', reject);
    worker.on('exit', code => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
    worker.send({ task });
  });
}

const PART_CAT_KEY = 'rb_part_categories_last_sync';
const CATALOG_EXTRAS_KEY = 'rb_catalog_extras_last_sync';

// Themes + Inventar-Minifiguren nachziehen, wenn der Haupt-Sync heute schon
// lief, diese Files aber noch fehlen (z.B. direkt nach dem Update auf die
// Katalog-Version). Analog zu syncPartCategoriesDaily.
async function syncCatalogExtrasDaily(today) {
  const m = await db.get(`SELECT value FROM global_settings WHERE key=$1`, [CATALOG_EXTRAS_KEY]).catch(() => null);
  if (m && m.value === today) return;
  try {
    await runWorker('themes',             TOTAL_STEPS, 'Themen laden...',           'themes.csv.gz');
    await runWorker('inventory_minifigs', TOTAL_STEPS, 'Inventar-Figuren laden...', 'inventory_minifigs.csv.gz');
    await db.run(
      `INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`,
      [CATALOG_EXTRAS_KEY, today]
    );
    log('catalog extras (themes + inventory_minifigs): Tagesimport erledigt');
  } catch (e) {
    log(`catalog extras: Tagesimport fehlgeschlagen: ${e.message}`);
  }
}

// Stellt sicher, dass part_categories AUCH dann taeglich importiert wird, wenn der
// Haupt-Sync heute bereits lief (z.B. weil das File nachtraeglich hinzugefuegt wurde).
async function syncPartCategoriesDaily(today) {
  const m = await db.get(`SELECT value FROM global_settings WHERE key=$1`, [PART_CAT_KEY]).catch(() => null);
  if (m && m.value === today) return;
  try {
    await runWorker('part_categories', TOTAL_STEPS, 'Kategorien laden...', 'part_categories.csv.gz');
    await db.run(
      `INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`,
      [PART_CAT_KEY, today]
    );
    log('part_categories: Tagesimport erledigt');
  } catch (e) {
    log(`part_categories: Tagesimport fehlgeschlagen: ${e.message}`);
  }
}

async function run() {
  // Ensure temp directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true });
  await ensureSchema();

  // Check last sync date
  const lastSync = await db.get(`SELECT value FROM global_settings WHERE key=$1`, [SYNC_KEY]).catch(()=>null);
  const today = new Date().toISOString().slice(0, 10);
  if (lastSync?.value === today) {
    log(`Already synced today (${today}) — skipping CSV download`);
    // part_categories dennoch taeglich sicherstellen (auch ohne Haupt-Sync).
    await syncPartCategoriesDaily(today);
    // Themes + Inventar-Minifiguren nachziehen (fehlen sonst bis morgen,
    // wenn der Haupt-Sync heute vor dem Update schon lief).
    await syncCatalogExtrasDaily(today);
    const s1 = { ready: true, step: 'Bereit (Cache)', progress: TOTAL_STEPS, total: TOTAL_STEPS };
    global.startupStatus = s1;
    db.run(`INSERT INTO global_settings (key,value) VALUES ('startup_status',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [JSON.stringify(s1)]).catch(() => {});
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

      await db.run(
        `INSERT INTO global_settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value=$2`,
        [SYNC_KEY, today]
      );
      // part_categories wurde in der Schleife importiert -> Tagesmarker mitsetzen.
      await db.run(
        `INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`,
        [PART_CAT_KEY, today]
      );
      // themes + inventory_minifigs ebenfalls in der Schleife importiert.
      await db.run(
        `INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`,
        [CATALOG_EXTRAS_KEY, today]
      );
      log(`CSV sync complete for ${today}`);
    } catch(e) {
      log(`CSV sync failed: ${e.message}`);
      return; // Don't try BL mapping if CSV sync failed
    }
  }

  // Fetch missing BL IDs + sync bl_part_number via shared function
  try {
    await fetchMissingBlIds();
  } catch(e) { log(`fetchMissingBlIds error: ${e.message}`); }

  const s2 = { ready: true, step: 'Bereit', progress: TOTAL_STEPS, total: TOTAL_STEPS };
  global.startupStatus = s2;
  db.run(`INSERT INTO global_settings (key,value) VALUES ('startup_status',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [JSON.stringify(s2)]).catch(() => {});
  monitor.update('csvImport', { status: 'done', progress: TOTAL_STEPS, total: TOTAL_STEPS, sub: null });
  log('Startup complete — server ready');

  // Fetch BrickLink color mapping from Rebrickable API and cache in DB
  // (not in CSV — only available via API)
  try {
    const key = await getRbKey().catch(() => null);
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
          const blId = c.external_ids?.BrickLink?.ext_ids?.[0] ?? c.external_ids?.BrickLink?.[0];
          if (blId != null) {
            await db.run(`UPDATE rb_colors SET bl_color_id = $1 WHERE id = $2`, [blId, c.id]).catch(() => {});
            count++;
          }
        }
        hasNext = !!data.next;
        page++;
      }
      log(`[colors] BrickLink color mapping: ${count} colors cached`);
    }
  } catch(e) {
    log(`[colors] BrickLink color mapping fetch failed: ${e.message}`);
  }
}

export { run };