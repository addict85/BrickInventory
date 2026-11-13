/**
 * Ein Sets-Bereich mit eigenem Zugang (erzeugeSets({ db: zweite, … })) liest und schreibt nur
 * dort, auch über Haushalt, Einstellungen, Lagerort, Preisalarm, Papierkorb, Katalog (Inventar),
 * Finanzen (fetchPrice, preisverlaufSet) und Aufträge. Der Zugang des Prozesses zählt mit und
 * darf keine Anfrage sehen. Das Haushaltsgedächtnis gilt je Zugang, nicht je Konto-ID.
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   A  waehrungVon() in src/sets/dienst.ts wieder über getSetting(uid, …) →
 *      rot: „Währung aus der zweiten Datenbank“, „Preisalarm …“ (Währung des
 *      Alarms) und „der Prozesszugang blieb unberührt“
 *   B  loescheSetFuer() in src/sets/loeschen.ts mit
 *      haushaltBereich().haushalt.schreibbereich(s.nutzer) → rot: „der
 *      Prozesszugang blieb unberührt“
 *   C  lagerortDesSetsSetzen() wieder über bestandBereich().lagerortDienst →
 *      rot: „Lagerort in der zweiten Datenbank“ und „der Prozesszugang …“
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   D  setPreis() in src/sets/preise.ts ruft fetchPrice() ohne den Zugang der
 *      Sets → rot: „Marktpreis aus dem Cache der zweiten Datenbank“ und „der
 *      Prozesszugang …“
 *   E  setPreisVerlauf() ruft preisverlaufSet() ohne sk.finanzen → rot:
 *      „Preisverlauf aus der zweiten Datenbank“ und „der Prozesszugang …“
 *   F  teilelisteDesSets() ruft neuestesInventar(setNum) ohne sk.katalog → rot:
 *      „Teileliste aus dem Katalog …“ und „der Prozesszugang …“
 *   G  derselbe stelleAuftragEin('bilder', …) ohne sk.auftraege → rot:
 *      „Teileliste … Bilderauftrag dort“ (kein Auftrag in der zweiten) und „der
 *      Prozesszugang …“
 *   H  src/haushalt/haushalt.ts wieder mit einem Gedächtnis für alle Zugänge →
 *      rot: „Haushaltsgedächtnis je Zugang“
 *   I  die Prüfung der Zugänge in erzeugeSets() entfernt → rot: „Katalog über
 *      einen anderen Zugang wird abgelehnt“
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
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
const { erzeugeKatalog } = _req('src/katalog/bereich.js');
const { erzeugeFinanzen } = _req('src/finanzen/bereich.js');
const { erzeugeAuftraege } = _req('src/auftraege/bereich.js');
const H = _req('src/haushalt/haushalt.js');
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
  for (const zustand of ['N', 'U'])
    await zweite.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
       VALUES ($1, $2, 'CHF', 40, 42.5, 45, 42.5, 7, NOW())`,
      [SN, zustand],
    );
  await zweite.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price)
     VALUES ($1, 'N', 'CHF', 41, 41, 39, 43)`,
    [SN],
  );
  await zweite.run('INSERT INTO rb_inventories (id, set_num, version) VALUES (77, $1, 1)', [SN]);
  await zweite.run(
    `INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare) VALUES (77, '3001', 0, 4, false)`,
  );

  N.verdrahteNacharbeit(N.OHNE_NACHARBEIT);
  const dienste = {
    katalog: erzeugeKatalog({ db: zweite }),
    finanzen: erzeugeFinanzen({ db: zweite }),
    auftraege: erzeugeAuftraege({ db: zweite }),
  };
  const sets = erzeugeSets({ db: zweite, nacharbeit: N.OHNE_NACHARBEIT, ...dienste });
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

  await t.test('Marktpreis aus dem Cache der zweiten Datenbank', async () => {
    const p = await sets.setPreis(uid, { nutzer: uid }, SN);
    assert.equal(p.error, undefined, JSON.stringify(p));
    assert.equal(Number(p.avg_price), 42.5);
    assert.equal(p.from_cache, true);
    assert.equal(p.currency, 'CHF');
  });

  await t.test('Preisverlauf aus der zweiten Datenbank', async () => {
    const v = await sets.setPreisVerlauf(uid, { nutzer: uid }, SN);
    assert.equal(Number(v.current.N?.avg_price), 42.5);
    assert.deepEqual(
      v.history_new.map(p => Number(p.avg_price)),
      [41],
    );
  });

  await t.test('Teileliste aus dem Katalog der zweiten Datenbank, Bilderauftrag dort', async () => {
    const r = await sets.teilelisteDesSets(SN, async () => {});
    assert.equal(r.source, 'db');
    assert.deepEqual(
      r.parts.map(p => [p.part_number, p.total_quantity]),
      [['3001', 4]],
    );
    const { n } = await zweite.get(
      "SELECT count(*)::int AS n FROM auftraege WHERE art = 'bilder' AND nutzlast->>'set_number' = $1",
      [SN],
    );
    assert.equal(n, 1, 'der Bilderauftrag steht in der zweiten Datenbank');
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

  await t.test('Katalog über einen anderen Zugang wird abgelehnt', () => {
    assert.throws(
      () =>
        erzeugeSets({
          db: zweite,
          nacharbeit: N.OHNE_NACHARBEIT,
          ...dienste,
          katalog: erzeugeKatalog({ db: db.standardDb() }),
        }),
      /katalog/,
    );
  });

  await t.test('Haushaltsgedächtnis je Zugang', async () => {
    // Dieselbe Konto-ID, zwei Datenbanken: In der zweiten hat sie ein Unterkonto, im Prozesszugang nicht.
    const UNTER = 987654;
    await zweite.run("INSERT INTO users (id, username, password_hash) VALUES ($1, 'unter_in_zwei', 'x')", [UNTER]);
    await zweite.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, UNTER]);
    H.leereHaushaltCache();
    assert.deepEqual((await H.haushaltVon(zweite, uid)).memberIds, [uid, UNTER]);
    const imProzess = await H.haushaltVon(db.standardDb(), uid);
    assert.ok(
      !imProzess.memberIds.includes(UNTER),
      `Gedächtnis der zweiten Datenbank geliehen: ${imProzess.memberIds}`,
    );
  });
});
