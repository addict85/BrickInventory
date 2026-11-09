/**
 * Der Datenbankzugang entsteht durch erzeugeDb(konfig), nicht beim Import:
 * Wer db/database lädt, öffnet keinen Pool; jeder Zugang hat seinen eigenen
 * Pool und seine eigene Transaktion. Der Prozess setzt seinen Zugang selbst
 * (server.ts, setzeStandardDb); der Kompatibilitätsweg legt ihn erst beim
 * ersten Gebrauch an.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in db/database.ts wieder `const pool = new Pool(...)` auf oberster Ebene →
 *      rot: „der Import öffnet keinen Pool“ (1 statt 0)
 *   B  in erzeugeDb() txClient ohne Vergleich `t.db === ich` → rot: „zwei Zugänge,
 *      zwei Transaktionen“ (b.inTransaktion() wahr in der Transaktion von a)
 *   C  setzeStandardDb() ohne die Prüfung auf einen schon gesetzten Zugang → rot:
 *      „der Zugang des Prozesses wird einmal gesetzt“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const DIST = require('./helpers/sources').DIST;
const { keineDb } = require('./helpers/db');

test('der Import öffnet keinen Pool', () => {
  // In einem eigenen Prozess: Hier hat der Testlauf den Zugang schon benutzt.
  const skript = `
    const pg = require('pg'); let n = 0; const Echt = pg.Pool;
    pg.Pool = class extends Echt { constructor(...a) { n++; super(...a); } };
    const db = require(${JSON.stringify(path.join(DIST, 'db', 'database.js'))});
    const nachImport = n;
    const eigener = db.erzeugeDb(db.dbKonfigAusUmgebung());
    const nachFabrik = n;
    void db.pool.totalCount;
    console.log(JSON.stringify([nachImport, nachFabrik, n]));
    Promise.all([eigener.pool.end(), db.pool.end()]).then(() => process.exit(0));`;
  const aus = execFileSync(process.execPath, ['-e', skript], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgres://niemand:x@127.0.0.1:1/keine' },
  });
  assert.deepEqual(JSON.parse(aus.trim().split('\n').pop()), [0, 1, 2], 'Import, Fabrik, erster Gebrauch');
});

test('zwei Zugänge, zwei Transaktionen', async t => {
  const db = _req('db/database.js');
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const a = db.erzeugeDb(db.dbKonfigAusUmgebung()),
    b = db.erzeugeDb(db.dbKonfigAusUmgebung());
  t.after(async () => {
    await a.pool.end();
    await b.pool.end();
    await db.pool.end().catch(() => {});
  });
  assert.notEqual(a.pool, b.pool);
  const SCHL = `fabrik-${process.pid}`;
  await a.run('DELETE FROM global_settings WHERE key = $1', [SCHL]);
  await a.transaction(async () => {
    assert.equal(a.inTransaktion(), true);
    assert.equal(b.inTransaktion(), false, 'die Transaktion von a gilt nicht für b');
    await a.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [SCHL, 'x']);
    assert.ok(await a.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]), 'a sieht die eigene Zeile');
    assert.equal(
      await b.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]),
      undefined,
      'b sieht nichts Unfertiges',
    );
  });
  assert.ok(await b.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]), 'nach COMMIT sieht b sie');
  await a.run('DELETE FROM global_settings WHERE key = $1', [SCHL]);
});

test('der Zugang des Prozesses wird einmal gesetzt', async () => {
  const db = _req('db/database.js');
  const standard = db.standardDb();
  assert.doesNotThrow(() => db.setzeStandardDb(standard), 'derselbe Zugang noch einmal ist kein Fehler');
  const anderer = db.erzeugeDb(db.dbKonfigAusUmgebung());
  try {
    assert.throws(() => db.setzeStandardDb(anderer), /schon gesetzt/);
  } finally {
    await anderer.pool.end();
  }
});
