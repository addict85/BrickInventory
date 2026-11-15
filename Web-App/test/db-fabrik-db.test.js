/**
 * Der Datenbankzugang entsteht durch erzeugeDb(konfig), nicht beim Import:
 * Wer db/database lädt, öffnet keinen Pool; jeder Zugang hat seinen eigenen
 * Pool und seine eigene Transaktion. Einen Zugang des Prozesses gibt es nicht:
 * Der Einstieg (server.ts, Skripte, Testhilfe) hält den seinen.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in db/database.ts wieder `const pool = new Pool(...)` auf oberster Ebene →
 *      rot: „der Import öffnet keinen Pool“ (1 statt 0)
 *   B  in erzeugeDb() txClient ohne Vergleich `t.db === ich` → rot: „zwei Zugänge,
 *      zwei Transaktionen“ (b.inTransaktion() wahr in der Transaktion von a)
 *   C  (11.11.2026) `export const get = …` mit einem Zugang des Prozesses zurück
 *      in db/database.ts → rot: „db/database führt keinen Zugang des Prozesses“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
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
    console.log(JSON.stringify([nachImport, nachFabrik]));
    eigener.pool.end().then(() => process.exit(0));`;
  const aus = execFileSync(process.execPath, ['-e', skript], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgres://niemand:x@127.0.0.1:1/keine' },
  });
  assert.deepEqual(JSON.parse(aus.trim().split('\n').pop()), [0, 1], 'Import, Fabrik');
});

test('zwei Zugänge, zwei Transaktionen', async t => {
  const db = testDaten();
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const modul = require(path.join(DIST, 'db', 'database.js'));
  const a = modul.erzeugeDb(modul.dbKonfigAusUmgebung()),
    b = modul.erzeugeDb(modul.dbKonfigAusUmgebung());
  t.after(async () => {
    await a.pool.end();
    await b.pool.end();
    await db.pool.end().catch(() => {});
  });
  assert.notEqual(a.pool, b.pool);
  const SCHL = `fabrik-${process.pid}`;
  await a.run('DELETE FROM global_settings WHERE key = $1', [SCHL]);
  await a.transaction(async tx => {
    assert.equal(a.inTransaktion(), true);
    assert.equal(b.inTransaktion(), false, 'die Transaktion von a gilt nicht für b');
    await tx.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [SCHL, 'x']);
    assert.ok(await tx.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]), 'a sieht die eigene Zeile');
    assert.equal(
      await b.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]),
      undefined,
      'b sieht nichts Unfertiges',
    );
  });
  assert.ok(await b.get('SELECT 1 FROM global_settings WHERE key = $1', [SCHL]), 'nach COMMIT sieht b sie');
  await a.run('DELETE FROM global_settings WHERE key = $1', [SCHL]);
});

test('db/database führt keinen Zugang des Prozesses', () => {
  const modul = require(path.join(DIST, 'db', 'database.js'));
  const prozess = [
    'pool',
    'all',
    'get',
    'run',
    'exec',
    'transaction',
    'initSchema',
    'initSchemaOnce',
    'standardDb',
    'setzeStandardDb',
    'inTransaktion',
    'getPoolStats',
  ].filter(n => n in modul);
  assert.deepEqual(prozess, []);
  assert.equal(typeof modul.erzeugeDb, 'function', 'die Fabrik bleibt');
});
