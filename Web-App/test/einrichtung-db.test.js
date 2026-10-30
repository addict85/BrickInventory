/**
 * Einrichtungs-Assistent: wann er erscheint, wann nicht mehr, und dass der
 * Testknopf nur bekannte Quellen anfasst.
 *
 * Gegenproben (25.10., gemessen):
 *   A  `!erledigt &&` aus der Bedingung entfernt   → rot: „erscheint nach Fertig weiter"
 *   B  Object.hasOwn in /quelle-testen entfernt   → rot: „__proto__ gilt als Quelle"
 *   C  istVerwalter-Prüfung in /einrichtung weg   → rot: „Nicht-Verwalter sieht den Stand"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

const SCHLUESSEL = ['rebrickable_api_key', 'brickset_api_key', 'bricklink_consumer_key',
  'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret', 'einrichtung_erledigt'];

test('Einrichtungs-Assistent', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);

  const name = `ew_${process.pid}`;
  const uid = (await db.get(
    "INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES ($1,'x',1,1) RETURNING id", [name])).id;
  const routen = { '/api/v1/settings': 'routes/settings.js' };
  const V = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, apiNutzer: { user_id: uid, is_admin: 1 }, routen, t });
  const N = testServer(_req, { sitzung: { userId: uid, isAdmin: false }, apiNutzer: { user_id: uid, is_admin: 0 }, routen, t });
  const ruf = async (srv, weg, body) => {
    const r = await fetch(srv.base + '/api/v1/settings' + weg, {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
  const setze = (k, v) => db.run(
    `INSERT INTO global_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, v]);

  try {
    await t.test('frische Installation: offen, mit Passwortschritt', async () => {
      const r = await ruf(V, '/einrichtung');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.offen, true);
      assert.equal(r.body.passwort_aendern, true);
      assert.deepEqual(r.body.quellen, { rebrickable: false, brickset: false, bricklink: false });
      assert.equal((await ruf(N, '/einrichtung')).status, 403, 'Nicht-Verwalter sieht den Stand');
    });

    await t.test('eingerichtet: Schlüssel da, Passwort gesetzt → nicht mehr offen', async () => {
      await setze('rebrickable_api_key', 'abc');
      await db.run('UPDATE users SET must_change_password = 0 WHERE id = $1', [uid]);
      const r = await ruf(V, '/einrichtung');
      assert.equal(r.body.offen, false);
      assert.equal(r.body.quellen.rebrickable, true);
      assert.ok(!JSON.stringify(r.body).includes('abc'), 'Der Stand gibt den Schlüssel heraus');
    });

    await t.test('„Fertig" schliesst ihn auch, wenn noch etwas fehlt', async () => {
      await db.run('DELETE FROM global_settings WHERE key = $1', ['rebrickable_api_key']);
      assert.equal((await ruf(V, '/einrichtung')).body.offen, true);
      assert.equal((await ruf(V, '/einrichtung/fertig', {})).status, 200);
      assert.equal((await ruf(V, '/einrichtung')).body.offen, false, 'erscheint nach Fertig weiter');
    });

    await t.test('Testknopf: nur bekannte Quellen, ohne Schlüssel eine verständliche Absage', async () => {
      for (const q of ['gibtsnicht', '__proto__', 'constructor']) {
        const r = await ruf(V, '/quelle-testen', { quelle: q });
        assert.equal(r.status, 400, q);
        assert.equal(r.body.code, 'quelle_unbekannt', `${q} gilt als Quelle`);
      }
      const bs = await ruf(V, '/quelle-testen', { quelle: 'brickset' });
      assert.equal(bs.status, 400);
      assert.equal(bs.body.code, 'quelle_test_fehlgeschlagen');
      assert.match(bs.body.error, /nicht konfiguriert/);
      const bl = await ruf(V, '/quelle-testen', { quelle: 'bricklink' });
      assert.match(bl.body.error, /nicht vollständig/);
      assert.equal((await ruf(N, '/quelle-testen', { quelle: 'brickset' })).status, 403);
    });
  } finally {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]).catch(() => {});
    for (const z of vorher) await setze(z.key, z.value).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
