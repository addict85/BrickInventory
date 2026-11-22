/**
 * Setup wizard: when it appears, when no longer, and that the
 * test button only touches known sources.
 *
 * Counter-checks (25.10., measured):
 *   A  `!erledigt &&` removed from the condition    → red: „erscheint nach Fertig weiter"
 *   B  Object.hasOwn removed in /quelle-testen     → red: „__proto__ gilt als Quelle"
 *   C  istVerwalter check in /einrichtung gone     → red: „Nicht-Verwalter sieht den Stand"
 *   D  (04.11.) in quellenAbsage the line for missing keys removed
 *      → red: „fehlender Schlüssel in Klartext" (source_test_failed)
 *   E  (13.11.) the check switchMust() removed in inboundLock() → red:
 *      “with the initial password the entry only leads to the change” (200 instead of 403)
 *
 * Via the real chain (testServer): with the initial password the entry only allows
 * the change; the UI only opens the wizard afterwards (sitzung.js:
 * openApp → mandatory change → reload → showApp → pruefeEinrichtung).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();

const SCHLUESSEL = [
  'rebrickable_api_key',
  'brickset_api_key',
  'bricklink_consumer_key',
  'bricklink_consumer_secret',
  'bricklink_token',
  'bricklink_token_secret',
  'einrichtung_erledigt',
];

test('setup wizard', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);

  const name = `ew_${process.pid}`;
  const uid = (
    await db.get(
      "INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES ($1,'x',true,true) RETURNING id",
      [name],
    )
  ).id;
  await adminWithFactor(_req, uid);
  const verwalter = { userId: uid, isAdmin: true };
  const V = testServer(_req, { sitzung: verwalter, t });
  const N = testServer(_req, { sitzung: { userId: uid, isAdmin: false }, t });
  const callFn = async (srv, weg, body) => {
    const r = await fetch(srv.base + '/api/v2/settings' + weg, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const put = (k, v) =>
    db.run(
      `INSERT INTO global_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k, v],
    );

  try {
    await t.test('with the initial password the entry only leads to the change', async () => {
      const r = await callFn(V, '/setup');
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.equal(r.body.code, 'password_change_required');
    });

    await t.test('fresh installation after the mandatory change: open, without password step', async () => {
      // Like POST /auth/change-password: account and session forget the obligation.
      await db.run('UPDATE users SET must_change_password = false WHERE id = $1', [uid]);
      delete verwalter.mussPasswortAendern;
      const r = await callFn(V, '/setup');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.open, true);
      assert.equal(r.body.change_password, false);
      assert.deepEqual(r.body.sources, { rebrickable: false, brickset: false, bricklink: false });
      const n = await callFn(N, '/setup');
      assert.equal(n.status, 403, 'Nicht-Verwalter sieht den Stand');
      assert.equal(n.body.code, 'admins_only');
    });

    await t.test('set up: key present, password set → no longer open', async () => {
      await put('rebrickable_api_key', 'abc');
      await _req('src/settings/settings.js').reencryptLegacyGlobalValues();
      const r = await callFn(V, '/setup');
      assert.equal(r.body.open, false);
      assert.equal(r.body.sources.rebrickable, true);
      assert.ok(!JSON.stringify(r.body).includes('abc'), 'Der Stand gibt den Schlüssel heraus');
    });

    await t.test('“Fertig” closes it even if something is still missing', async () => {
      await db.run('DELETE FROM global_settings WHERE key = $1', ['rebrickable_api_key']);
      assert.equal((await callFn(V, '/setup')).body.open, true);
      assert.equal((await callFn(V, '/setup/complete', {})).status, 200);
      assert.equal((await callFn(V, '/setup')).body.open, false, 'erscheint nach Fertig weiter');
    });

    await t.test('test button: only known sources, without a key an understandable refusal', async () => {
      for (const q of ['gibtsnicht', '__proto__', 'constructor']) {
        const r = await callFn(V, '/test-source', { source: q });
        assert.equal(r.status, 400, q);
        assert.equal(r.body.code, 'source_unknown', `${q} gilt als Quelle`);
      }
      const bs = await callFn(V, '/test-source', { source: 'brickset' });
      assert.equal(bs.status, 400);
      assert.equal(bs.body.code, 'source_without_key', 'fehlender Schlüssel in Klartext');
      assert.match(bs.body.error, /Für Brickset ist noch kein Zugang gespeichert/);
      assert.match(bs.body.details, /nicht konfiguriert/, 'der rohe Grund steht unter „Details“');
      const bl = await callFn(V, '/test-source', { source: 'bricklink' });
      assert.equal(bl.body.code, 'source_without_key');
      assert.match(bl.body.details, /nicht vollständig/);
      assert.equal((await callFn(N, '/test-source', { source: 'brickset' })).status, 403);
    });
  } finally {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]).catch(() => {});
    for (const z of vorher) await put(z.key, z.value).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
