/**
 * The two diagnostic probes of the administration answer over the real server: the image probe
 * shows what the CDN delivers, the price probe what flows into a set's market price, and both stay
 * closed to an account without admin rights. The CDN is a local stub (helpers/https-stub.js).
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  the route POST /api/v2/admin/img-probe removed → red “the image probe …” (404)
 *   B  requireApiAdmin removed from price-probe → red “without admin rights …” (200 instead of 403)
 *   C  imageProbe() without proxy_failures → red “the image probe …” (contract: field missing)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const { httpsStub } = require('./helpers/https-stub');

test('admin probes', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const P = process.pid;
  const names = [`probe_chef_${P}`, `probe_kind_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
  const ids = [];
  for (const [i, n] of names.entries())
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
             VALUES ($1, 'x', $2, true, true) RETURNING id`,
          [n, i === 0],
        )
      ).id,
    );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await adminWithFactor(_req, ids[0]);
  const admin = testServer(_req, { session: { userId: ids[0], username: names[0], isAdmin: true }, t });
  const child = testServer(_req, { session: { userId: ids[1], username: names[1], isAdmin: false }, t });
  const post = (base, p, body) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

  await t.test('the image probe shows the CDN response', async () => {
    await httpsStub(t, (_c, res) => {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-encoding': 'gzip' });
      res.end(Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]));
    });
    const r = await post(admin.base, '/api/v2/admin/img-probe', {
      url: 'https://cdn.rebrickable.com/media/sets/10294-1.jpg',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.probes[0].content_encoding, 'gzip');
    assert.equal(typeof r.body.proxy_failures.notFound, 'number');
  });

  await t.test('the price probe answers for a set', async () => {
    const r = await post(admin.base, '/api/v2/admin/price-probe', { set: '10294-1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test('without admin rights both stay closed', async () => {
    const a = await post(child.base, '/api/v2/admin/img-probe', {
      url: 'https://cdn.rebrickable.com/media/sets/1-1.jpg',
    });
    const b = await post(child.base, '/api/v2/admin/price-probe', { set: '10294-1' });
    assert.deepEqual([a.status, b.status], [403, 403]);
  });
});
