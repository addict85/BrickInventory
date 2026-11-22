/**
 * The route for data/images/ over the real server: without login nothing goes out, and a file
 * missing on disk heals itself via the image proxy to the CDN address the catalog remembers.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  requireLoginOrToken removed from the route AND the check in deliverImage → red “without login …”
 *      (either one alone stays green: the other answers 401)
 *   B  the redirect to the image proxy removed → red “a missing file …” (404 instead of 302)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('image route: login and CDN healing', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const P = process.pid;
  const PART = `irt${P}`;
  const CDN = `https://cdn.rebrickable.com/media/parts/${PART}.jpg`;
  const name = `irt-${P}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, image_url, image_local) VALUES ($1,4,$2,$3)`, [
    PART,
    CDN,
    `/images/parts/${PART}_4.jpg`,
  ]);
  t.after(async () => {
    await db.run('DELETE FROM part_color_catalog WHERE part_number = $1', [PART]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const anon = testServer(_req, { t });
  const signedIn = testServer(_req, { sitzung: { userId: uid, username: name }, t });
  const get = base => fetch(`${base}/images/parts/${PART}_4.jpg`, { redirect: 'manual' });

  await t.test('without login nothing goes out', async () => {
    assert.equal((await get(anon.base)).status, 401);
  });
  await t.test('a missing file goes via the image proxy to the CDN', async () => {
    const r = await get(signedIn.base);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), `/api/v1/img-proxy?url=${encodeURIComponent(CDN)}`);
  });
});
