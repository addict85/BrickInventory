/**
 * Der tägliche Katalog-Import — geprüft an dem, was andere Verbindungen
 * währenddessen sehen.
 *
 * ── Warum gegen echtes Postgres ─────────────────────────────────────────────
 * Der Kern des Umbaus ist eine Aussage über Sichtbarkeit: Ein Leser darf
 * während des Imports NIE eine leere Tabelle sehen. Das lässt sich nur mit
 * zwei echten Verbindungen prüfen — am Quelltext wäre es bloss die Frage, ob
 * irgendwo „BEGIN" steht.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const { ROOT, buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const db   = _req('db/database.js');

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Katalog-Import tauscht, statt zu leeren', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // Die Import-Tabellen legt der CSV-Abgleich selbst an.
  await db.run(`CREATE TABLE IF NOT EXISTS rb_colors (
    id INTEGER PRIMARY KEY, name TEXT, rgb TEXT, is_trans TEXT, bl_color_id INTEGER)`);

  const DATA_DIR = _req('utils/appPaths.js').DATA_DIR;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  /** CSV-Datei erzeugen, wie sie der Download entpackt hinterlässt. */
  function csvSchreiben(name, zeilen) {
    fs.writeFileSync(path.join(DATA_DIR, name), zeilen.join('\n') + '\n', 'utf8');
  }

  await t.test('während des Imports sieht ein zweiter Leser durchgehend Daten', async () => {
    await db.run('DELETE FROM rb_colors');
    await db.run(`INSERT INTO rb_colors (id, name, rgb, is_trans)
                  SELECT g, 'alt-' || g, 'FFFFFF', 'f' FROM generate_series(1, 300) g`);

    csvSchreiben('colors.csv.tmp', ['id,name,rgb,is_trans']
      .concat(Array.from({ length: 300 }, (_, i) => `${i + 1},neu-${i + 1},C91A09,f`)));

    // Zweite Verbindung: zählt fortlaufend mit, während der Import läuft.
    const leser = await db.pool.connect();
    let minimum = Infinity;
    let laeuft = true;
    const beobachten = (async () => {
      while (laeuft) {
        const { rows } = await leser.query('SELECT count(*)::int AS c FROM rb_colors');
        minimum = Math.min(minimum, rows[0].c);
        await new Promise(r => setTimeout(r, 5));
      }
    })();

    const worker = _req('jobs/csvImportWorker.js');
    const total = await worker.TASKS.colors();

    laeuft = false;
    await beobachten;
    leser.release();

    assert.equal(total, 300);
    assert.notEqual(minimum, 0,
      'ein Leser hat die Tabelle LEER gesehen — genau das Fenster, das der Umbau schliessen sollte');
    const jetzt = await db.get(`SELECT name FROM rb_colors WHERE id=1`);
    assert.equal(jetzt.name, 'neu-1', 'die neuen Daten sind nicht angekommen');
  });

  await t.test('eine leere Datei ersetzt den Bestand nicht', async () => {
    await db.run('DELETE FROM rb_colors');
    await db.run(`INSERT INTO rb_colors (id, name, rgb, is_trans) VALUES (1,'bestand','FFFFFF','f')`);
    csvSchreiben('colors.csv.tmp', ['id,name,rgb,is_trans']);

    const worker = _req('jobs/csvImportWorker.js');
    await assert.rejects(() => worker.TASKS.colors(), /0 Zeilen/,
      'ein abgebrochener Download hätte den Katalog gelöscht');
    const übrig = await db.get('SELECT count(*)::int AS c FROM rb_colors');
    assert.equal(übrig.c, 1, 'der alte Bestand ist trotz Abbruch verschwunden');
  });

  await t.test('ein fehlerhafter Block bricht den Import ab, statt Zeilen zu verlieren', async () => {
    await db.run('DELETE FROM rb_colors');
    await db.run(`INSERT INTO rb_colors (id, name, rgb, is_trans) VALUES (1,'bestand','FFFFFF','f')`);
    // Einen Insert-Fehler erzwingen, ohne den Worker zu verbiegen: eine
    // Bedingung, die der Bestand erfüllt und die neue Zeile nicht. Die
    // Schattentabelle übernimmt sie über LIKE … INCLUDING ALL.
    await db.run(`ALTER TABLE rb_colors ADD CONSTRAINT rb_colors_name_kurz CHECK (length(name) < 10)`);
    csvSchreiben('colors.csv.tmp', ['id,name,rgb,is_trans', '1,viel-zu-langer-name,C91A09,f']);

    const worker = _req('jobs/csvImportWorker.js');
    await assert.rejects(() => worker.TASKS.colors(),
      'ein abgewiesener Block wurde verschluckt — der Import meldet Erfolg mit fehlenden Zeilen');
    const übrig = await db.get('SELECT count(*)::int AS c FROM rb_colors');
    assert.equal(übrig.c, 1, 'der alte Bestand ist trotz Abbruch verschwunden');
    await db.run(`ALTER TABLE rb_colors DROP CONSTRAINT rb_colors_name_kurz`);
  });

  await t.test('verdoppelte Anführungszeichen bleiben ein Anführungszeichen', async () => {
    await db.run('DELETE FROM rb_colors');
    csvSchreiben('colors.csv.tmp', ['id,name,rgb,is_trans', '7,"Trans ""Neon"" Grün",C91A09,f']);
    const worker = _req('jobs/csvImportWorker.js');
    await worker.TASKS.colors();
    const zeile = await db.get('SELECT name FROM rb_colors WHERE id=7');
    assert.equal(zeile.name, 'Trans "Neon" Grün');
  });

  await t.test('nach dem Lauf bleibt keine Schattentabelle zurück', async () => {
    const rest = await db.all(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%\\_import'`);
    assert.deepEqual(rest.map(r => r.tablename), []);
  });

  await db.pool.end().catch(() => {});
});

test('der CSV-Download hat ein Zeitlimit', () => {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'jobs', 'rebrickableCsvSync.ts'), 'utf8'));
  const dl = src.slice(src.indexOf('async function downloadToTmp'), src.indexOf('async function runWorker'));
  // Diese eine Prüfung liest Quelltext statt Verhalten: Ein echter Nachweis
  // bräuchte einen TLS-Server, der die Verbindung annimmt und dann schweigt.
  // Deshalb wenigstens die Form festhalten — der Aufruf muss eine eigene
  // Anweisung sein. Ein `if (false) req.setTimeout(…)` fällt damit auf, was
  // eine blosse Namenssuche nicht könnte (siehe Nachtrag 11).
  assert.match(dl, /^\s*req\.setTimeout\(/m,
    'ohne Frist bleibt eine hängende Verbindung für immer stehen — beim Erststart hängt dann die Startanzeige');
  assert.match(dl, /destroy\(/, 'die Frist bricht die Anfrage nicht ab');
});

test('die entpackten Zwischendateien werden aufgeräumt', () => {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'jobs', 'rebrickableCsvSync.ts'), 'utf8'));
  const rw = src.slice(src.indexOf('async function runWorker'), src.indexOf('function importInWorker'));
  assert.match(rw, /finally\s*\{[\s\S]*unlink/,
    'ohne unlink im finally bleibt inventory_parts.csv.tmp (rund 1 GB) dauerhaft liegen');
});
