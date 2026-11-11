/**
 * Ein Sets-Bereich mit eigenem Zugang (erzeugeSets({ db: zweite, … })) liest und
 * schreibt nur dort, auch wo er andere Bereiche braucht: Haushalt (writableIds,
 * blickfeldAus), Einstellungen (Währung), Lagerort, Preisalarm und Papierkorb.
 * Der Zugang des Prozesses zählt mit; er darf keine einzige Anfrage sehen.
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   A  waehrungVon() in src/sets/dienst.ts wieder über getSetting(uid, …) →
 *      rot: „Währung aus der zweiten Datenbank“, „Preisalarm …“ (Währung des
 *      Alarms) und „der Prozesszugang blieb unberührt“
 *   B  loescheSetFuer() in src/sets/loeschen.ts mit
 *      haushaltBereich().haushalt.writableIds(s.nutzer) → rot: „der
 *      Prozesszugang blieb unberührt“
 *   C  lagerortDesSetsSetzen() wieder über bestandBereich().lagerortDienst →
 *      rot: „Lagerort in der zweiten Datenbank“ und „der Prozesszugang …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { testName, raeumeReste, id } = require('./helpers/testnamen');
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { erzeugeSets } = _req('src/sets/bereich.js');
const { erzeugeDb } = _req('db/database.js');
const N = _req('src/auftraege/nacharbeit.js');

const NAME = testName('sets_zweite');
const SN = '99877-1';

/** Zählt jede Anfrage, die über den Zugang oder seinen Pool geht. */
function zaehle(zugang) {
  const n = { anfragen: 0 };
  const pool = zugang.pool;
  const echt = { query: pool.query.bind(pool), connect: pool.connect.bind(pool) };
  pool.query = (...a) => {
    n.anfragen++;
    return echt.query(...a);
  };
  pool.connect = (...a) => {
    n.anfragen++;
    return echt.connect(...a);
  };
  n.zurueck = () => Object.assign(pool, echt);
  return n;
}

test('Sets mit zweitem Zugang', { concurrency: 1, timeout: 180_000 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await raeumeReste(admin, 'sets_zweite');
  await admin.query(`CREATE DATABASE ${id(NAME)}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + NAME;
  const zweite = erzeugeDb({ verbindung: { connectionString: url.toString() }, pool: { max: 4 } });
  t.after(async () => {
    await zweite.benachrichtigung.close();
    await zweite.pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
    quellen.buildAndRequire();
    await db.pool.end().catch(() => {});
  });
  await zweite.initSchema();

  const { id: uid } = await zweite.get(
    "INSERT INTO users (username, password_hash) VALUES ('nur_in_zwei', 'x') RETURNING id",
  );
  await zweite.run("INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')", [uid]);
  await zweite.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SN]);

  N.verdrahteNacharbeit(N.OHNE_NACHARBEIT);
  const sets = erzeugeSets({ db: zweite, nacharbeit: N.OHNE_NACHARBEIT });
  const prozess = zaehle(db.standardDb());
  t.after(() => prozess.zurueck());

  await t.test('Währung aus der zweiten Datenbank', async () => {
    assert.equal(await sets.waehrungVon(uid), 'CHF');
  });

  await t.test('Lagerort in der zweiten Datenbank', async () => {
    const { ort, n } = await sets.lagerortDesSetsSetzen(uid, SN, 'Kiste Z');
    assert.equal(ort, 'Kiste Z');
    assert.equal(n, 1);
    const { orte } = await sets.lagerorteMitVorgabe(uid, undefined);
    assert.ok(
      orte.some(o => o.name === 'Kiste Z' || o === 'Kiste Z'),
      JSON.stringify(orte),
    );
  });

  await t.test('Preisalarm in der zweiten Datenbank', async () => {
    const alarm = await sets.alarmDesSetsSetzen(uid, SN, { richtung: 'unter', schwelle: 12.5, condition: 'N' });
    assert.equal(alarm.currency_code, 'CHF', 'die Währung des Alarms kommt aus der zweiten Datenbank');
    assert.equal((await sets.setAlarmeLesen(uid, SN)).length, 1);
    assert.equal(await sets.alarmDesSetsLoeschen(uid, SN, 'N'), 1);
  });

  await t.test('Löschen über Haushalt und Papierkorb der zweiten Datenbank', async () => {
    const papierkorb = await sets.loescheSetFuer({ nutzer: uid }, SN);
    assert.equal(papierkorb.length, 1);
    assert.equal((await zweite.get('SELECT count(*)::int AS n FROM sets WHERE user_id = $1', [uid])).n, 0);
    assert.equal(
      (await zweite.get("SELECT count(*)::int AS n FROM papierkorb WHERE user_id = $1 AND art = 'set'", [uid])).n,
      1,
    );
  });

  await t.test('der Prozesszugang blieb unberührt', () => {
    assert.equal(prozess.anfragen, 0);
  });
});
