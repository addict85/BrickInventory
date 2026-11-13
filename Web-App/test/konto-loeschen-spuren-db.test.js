/**
 * Ein gelöschtes Konto überlebt weder in den Kopien vor Migrationen
 * (vor_migration_*) noch mit Namen im Verwaltungsprotokoll; alte Kopien und
 * alte Protokollzeilen verfallen im Aufräumlauf.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in spurenLoeschen() entferneKontoAusSicherungen() entfernt → rot:
 *      „das gelöschte Konto ist in keiner Kopie …“ (users und sets)
 *   B  in raeumeProtokollAuf() das UPDATE auf ziel_name entfernt → rot:
 *      „nach dem Aufräumlauf nennt das Verwaltungsprotokoll den Namen nicht mehr“
 *   C  raeumeAlteSicherungenAuf() vergleicht mit 3000 statt `tage` Tagen →
 *      rot: „Kopien älter als die Frist …“
 *   D  raeumeProtokollAuf() mit 3650 statt 365 Tagen → rot: „Protokollzeilen
 *      älter als ein Jahr …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const AUTH = require('./helpers/sources').einhaengung('auth');
const { sichereNutzerdaten, raeumeAlteSicherungenAuf } = _req('db/migrate.js');
const { raeumeProtokollAuf } = _req('src/konto/prozess.js').kontoBereich().protokoll;
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('Kontolöschung ohne Spuren', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const P = process.pid,
    NAME = `spur_${P}`,
    CHEF = `spur_chef_${P}`,
    PASS = 'Spuren-Passwort-17';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, CHEF]]);
  const lege = async (n, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [n, `${n}@example.org`, await bcrypt.hash(PASS, 4), admin],
      )
    ).id;
  const uid = await lege(NAME, false),
    chef = await lege(CHEF, true);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, `8${P % 100000}-1`]);
  await db.run(
    `INSERT INTO verwaltungsprotokoll (verwalter_id, ziel_id, ziel_name, aktion)
    VALUES ($1, $2, $3, 'passwort_gesetzt')`,
    [chef, uid, NAME],
  );
  const client = await db.pool.connect();
  let schema;
  try {
    schema = await sichereNutzerdaten(client, ['probe']);
  } finally {
    client.release();
  }
  t.after(async () => {
    await db.run(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await db.run('DROP SCHEMA IF EXISTS vor_migration_20200101000000000 CASCADE').catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, chef]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const zaehle = async (tabelle, spalte) =>
    (await db.get(`SELECT count(*)::int n FROM ${schema}.${tabelle} WHERE ${spalte} = $1`, [uid])).n;
  assert.equal(await zaehle('users', 'id'), 1, 'Vorbedingung: das Konto steht in der Kopie');
  assert.equal(await zaehle('sets', 'user_id'), 1, 'Vorbedingung: sein Set steht in der Kopie');

  const sitzung = { userId: uid, username: NAME, destroy: fertig => fertig() };
  const { base } = testServer(_req, { sitzung, t });
  const r = await fetch(`${base}${AUTH}/konto`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASS }),
  });
  assert.equal(r.status, 200, await r.clone().text());

  await t.test('das gelöschte Konto ist in keiner Kopie mehr', async () => {
    assert.equal(await zaehle('users', 'id'), 0);
    assert.equal(await zaehle('sets', 'user_id'), 0);
    assert.ok(
      (await db.get(`SELECT count(*)::int n FROM ${schema}.users WHERE id = $1`, [chef])).n === 1,
      'andere Konten bleiben',
    );
  });

  await t.test('nach dem Aufräumlauf nennt das Verwaltungsprotokoll den Namen nicht mehr', async () => {
    await raeumeProtokollAuf();
    const z = await db.all('SELECT ziel_id, ziel_name FROM verwaltungsprotokoll WHERE ziel_id = $1', [uid]);
    assert.equal(z.length, 1, 'die Zeile selbst bleibt');
    assert.equal(z[0].ziel_name, null);
  });

  await t.test('Kopien älter als die Frist verschwinden im Aufräumlauf', async () => {
    await db.run('CREATE SCHEMA vor_migration_20200101000000000');
    await db.run('CREATE TABLE vor_migration_20200101000000000.users (id int)');
    assert.ok((await raeumeAlteSicherungenAuf(db)) >= 1);
    const da = (await db.all(`SELECT nspname FROM pg_namespace WHERE nspname ~ '^vor_migration_'`)).map(z => z.nspname);
    assert.ok(!da.includes('vor_migration_20200101000000000'), da.join(', '));
    assert.ok(da.includes(schema), 'die frische Kopie bleibt');
  });

  await t.test('Protokollzeilen älter als ein Jahr verschwinden im Aufräumlauf', async () => {
    const alt = (
      await db.get(
        `INSERT INTO verwaltungsprotokoll (zeit, verwalter_id, ziel_id, ziel_name, aktion)
      VALUES (NOW() - INTERVAL '400 days', $1, $1, 'alt', 'konto_angelegt') RETURNING id`,
        [chef],
      )
    ).id;
    const jung = (
      await db.get(
        `INSERT INTO verwaltungsprotokoll (zeit, verwalter_id, ziel_id, ziel_name, aktion)
      VALUES (NOW() - INTERVAL '300 days', $1, $1, 'jung', 'konto_angelegt') RETURNING id`,
        [chef],
      )
    ).id;
    await raeumeProtokollAuf();
    const ids = (await db.all('SELECT id FROM verwaltungsprotokoll WHERE id = ANY($1)', [[alt, jung]])).map(z => z.id);
    assert.deepEqual(ids, [jung]);
  });
});
