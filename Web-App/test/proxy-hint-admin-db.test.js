/**
 * The hint about a proxy in front of Caddy (all clients with one address) does
 * not only stand in the log: GET /api/v2/admin/jobs carries it for admins, and
 * the background jobs show it (proxy-hint-ui.test.js).
 *
 * Counter-checks (measured 13.11.2026, each on its own):
 *   A  `remember(…)` deleted in onlyClientAddress() → red: “after the
 *      hint in the log it is in the response” (null)
 *   B  `proxy_hinweis` deleted from the response in routes/api/admin.ts →
 *      red: “without a hint: null” and “after the hint …” (undefined)
 *   C  startup/app.ts does not put the hint provider into app.locals → red: “the
 *      app puts its hint provider where …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const { proxyHint, ONE_ADDRESS } = _req('src/http/proxyHint.js');

test('proxy hint in the response for administrators', { concurrency: 1 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  const NAME = `proxyhinweis-${process.pid}`;
  // The owner role creates accounts: the runtime role only writes names into users (0117).
  const daten = require('./helpers/sources').testData();
  await daten.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (
    await daten.get(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true) RETURNING id`, [NAME])
  ).id;
  t.after(async () => {
    await daten.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  // Like startup/app.ts: the hint provider lies on the app object, the administration reads it there.
  let now = 0;
  const meldungen = [];
  const mw = proxyHint(
    '172.28.73.10',
    m => meldungen.push(m),
    () => now,
  );
  await adminWithFactor(_req, uid);
  const { app, base } = testServer(_req, { sitzung: { userId: uid, isAdmin: 1 }, t });
  app.locals.proxyHint = mw;
  const jobs = async () => (await fetch(`${base}/api/v2/admin/jobs`)).json();

  await t.test('without a hint: null', async () => {
    const d = await jobs();
    assert.equal(d.success, true);
    assert.equal(d.proxy_hint, null);
  });

  await t.test('after the hint in the log it is in the response', async () => {
    // For one hour only the address of the proxy in front, as behind Nginx Proxy Manager with `keiner`.
    for (let i = 0; i <= ONE_ADDRESS.requests; i++) {
      now = Math.round((i / ONE_ADDRESS.requests) * 61 * 60_000);
      const ip = '::ffff:172.28.73.20';
      mw({ ip, socket: { remoteAddress: '172.28.73.10' }, headers: { 'x-forwarded-for': ip } }, {}, () => {});
    }
    assert.equal(meldungen.length, 1, 'Hinweis im Protokoll');
    const h = (await jobs()).proxy_hint;
    assert.deepEqual([h?.kind, h?.vars?.ip], ['single_address', '172.28.73.20'], JSON.stringify(h));
    assert.ok(h.vars.minutes >= 60 && h.vars.count >= ONE_ADDRESS.requests, JSON.stringify(h));
  });

  await t.test('the app puts its hint provider where the administration reads', () => {
    const echt = _req('startup/app.js').buildApp({
      pool: db.systemPool,
      config: _req('src/infra/config.js').config(),
      sessionSecret: 'p'.repeat(48),
      services: require('./helpers/sources').testServices(),
    });
    const { proxyHintStatus } = _req('src/http/proxyHint.js');
    assert.equal(proxyHintStatus(echt), null);
    const leise = console.warn;
    console.warn = () => {};
    try {
      const req = { socket: { remoteAddress: '172.28.73.30' }, headers: { 'x-forwarded-for': '198.51.100.4' } };
      echt.locals.proxyHint(req, {}, () => {});
    } finally {
      console.warn = leise;
    }
    assert.deepEqual(proxyHintStatus(echt), { kind: 'docker_network', vars: { ip: '172.28.73.30' } });
  });
});
