/**
 * Merkposten verschieben und übernehmen schreiben mehrfach; scheitert ein
 * späterer Schritt, bleibt nichts halb geschrieben. Den Fehler erzwingt ein
 * Trigger auf price_alerts — der Alarm ist jeweils der letzte Schritt.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  verschiebeMerkposten() ohne mitMerkpostenSperre (Rumpf direkt) → rot:
 *      „verschieben: der Merkposten bleibt beim alten Konto“
 *   B  uebernimm() ohne mitMerkpostenSperre → rot: „übernehmen: kein Set im
 *      Bestand, der Merkposten steht noch“
 *   C  alarmUebertragen() wieder mit .catch(meldeFehler) → rot: „verschieben:
 *      der Fehler kommt an“
 *   D  uebertrageAlarm() ohne NOT EXISTS → rot: „Ziel mit eigenem Alarm“
 *      (Primärschlüsselverletzung)
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

const U = {};

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  for (const name of ['von', 'zu']) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  await db.run(`INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts)
                VALUES ('75192-1', 'Millennium Falcon', 2017, 158, 7541)`);
  // Die Bremse fragt eine Funktion statt einer Sitzungsvariable: Das gilt
  // sofort für jede Verbindung des Pools.
  await db.exec(`CREATE FUNCTION bremse_an() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION alarm_bremse() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF bremse_an() THEN RAISE EXCEPTION 'erzwungen'; END IF;
      RETURN COALESCE(NEW, OLD);
    END $$;
    CREATE TRIGGER alarm_bremse BEFORE UPDATE OR DELETE ON price_alerts
      FOR EACH ROW EXECUTE FUNCTION alarm_bremse();`);
}

const schalte = an =>
  db.exec(`CREATE OR REPLACE FUNCTION bremse_an() RETURNS boolean LANGUAGE sql AS $$ SELECT ${an} $$`);
async function mitBremse(fn) {
  await schalte(true);
  try {
    return await fn();
  } finally {
    await schalte(false);
  }
}

test('Merkliste schreibt ganz oder gar nicht', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req, { migrieren: false }))) return;
  t.after(() => db.pool.end().catch(() => {}));
  await seed();
  const W = _req('src/merkliste/merkliste.js');
  const alarm = uid =>
    db.run(
      `INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code)
                                  VALUES ($1, '75192-1', 'N', 'unter', 500, 'EUR')`,
      [uid],
    );
  const merk = async uid =>
    (await db.all(`SELECT user_id FROM wanted WHERE set_number='75192-1' AND condition='N' AND user_id=$1`, [uid]))
      .length;
  const alarme = async uid =>
    (await db.all(`SELECT 1 FROM price_alerts WHERE set_number='75192-1' AND condition='N' AND user_id=$1`, [uid]))
      .length;

  await t.test('verschieben: der Fehler kommt an', async () => {
    await W.legeMerkpostenAn(U.von, '75192-1', 'N');
    await alarm(U.von);
    await mitBremse(() => assert.rejects(W.verschiebeMerkposten(U.von, '75192-1', 'N', U.zu), /erzwungen/));
  });

  await t.test('verschieben: der Merkposten bleibt beim alten Konto', async () => {
    assert.equal(await merk(U.von), 1, 'Merkposten ist trotz Fehler gewandert');
    assert.equal(await merk(U.zu), 0);
    assert.equal(await alarme(U.von), 1);
  });

  await t.test('verschieben ohne Fehler nimmt Merkposten und Alarm mit', async () => {
    const r = await W.verschiebeMerkposten(U.von, '75192-1', 'N', U.zu);
    assert.deepEqual(r, { verschoben: true, zusammengefuehrt: false });
    assert.equal(await merk(U.zu), 1);
    assert.equal(await alarme(U.zu), 1);
    assert.equal(await alarme(U.von), 0);
  });

  await t.test('Ziel mit eigenem Alarm: dessen Alarm gilt, der Merkposten wandert', async () => {
    await W.verschiebeMerkposten(U.zu, '75192-1', 'N', U.von);
    await db.run(`DELETE FROM price_alerts`);
    await alarm(U.von);
    await alarm(U.zu);
    await db.run(`UPDATE price_alerts SET schwelle = 123 WHERE user_id=$1`, [U.zu]);
    const r = await W.verschiebeMerkposten(U.von, '75192-1', 'N', U.zu);
    assert.equal(r.verschoben, true);
    const zeilen = await db.all(`SELECT user_id, schwelle::float AS s FROM price_alerts`);
    assert.deepEqual(zeilen, [{ user_id: U.zu, s: 123 }]);
  });

  await t.test('übernehmen: kein Set im Bestand, der Merkposten steht noch', async () => {
    await mitBremse(() => assert.rejects(W.uebernimm(U.zu, U.zu, '75192-1', 'N', { quantity: 1 }), /erzwungen/));
    assert.equal(
      (await db.all(`SELECT 1 FROM sets WHERE user_id=$1`, [U.zu])).length,
      0,
      'Das Set ist erfasst, obwohl das Streichen scheiterte',
    );
    assert.equal(await merk(U.zu), 1);
  });

  await t.test('übernehmen ohne Fehler: Set erfasst, Merkposten und Alarm weg', async () => {
    const r = await W.uebernimm(U.zu, U.zu, '75192-1', 'N', { quantity: 1 });
    assert.equal(r.action, 'added');
    assert.equal((await db.all(`SELECT 1 FROM sets WHERE user_id=$1`, [U.zu])).length, 1);
    assert.equal(await merk(U.zu), 0);
    assert.equal(await alarme(U.zu), 0);
  });
});
