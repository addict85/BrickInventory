/**
 * The route for data/images/ over the real server: without login nothing goes out, and a file
 * missing on disk heals itself via the image proxy to the CDN address the catalog remembers.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  requireLoginOrToken removed from the route AND the check in deliverImage → red “without login …”
 *      (either one alone stays green: the other answers 401)
 *   B  the redirect to the image proxy removed → red “a missing file …” (404 instead of 302)
 *   C  originalInsteadOfPreview without the previewFrom call → red “a missing preview …” (never created)
 *   D  the same with `await previewFrom(…)` instead of setImmediate → red the same test (the
 *      preview already exists when the answer arrives)
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
  await t.test('a missing preview: the original at once, the preview afterwards', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { Jimp } = require(path.join(__dirname, '..', 'node_modules', 'jimp'));
    const { DATA_DIR } = _req('src/infra/appPaths.js');
    const name = `zzroute${P}`;
    const original = path.join(DATA_DIR, 'images', 'sets', `${name}.jpg`);
    const preview = path.join(DATA_DIR, 'images', 'sets', `${name}_thumb.jpg`);
    fs.mkdirSync(path.dirname(original), { recursive: true });
    await new Jimp({ width: 2400, height: 1800, color: 0x00aa00ff }).write(original);
    t.after(() => {
      for (const f of [original, preview]) fs.rmSync(f, { force: true });
    });
    const r = await fetch(`${signedIn.base}/images/sets/${name}_thumb.jpg`);
    const body = Buffer.from(await r.arrayBuffer());
    assert.equal(r.status, 200);
    assert.ok(body.equals(fs.readFileSync(original)), 'the answer is not the original');
    assert.equal(fs.existsSync(preview), false, 'the request waited for the preview');
    const { bis } = require('./helpers/time');
    assert.ok(await bis(() => fs.existsSync(preview), 10000), 'the preview is never created');
  });
});
