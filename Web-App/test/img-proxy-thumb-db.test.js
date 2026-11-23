/**
 * ?thumb=1 at the image proxy against a local CDN (helpers/https-stub.js): the request gets the
 * original at once, the preview is computed in the background, and a tile wall asking for the same
 * image starts it only once.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  queueThumb without the _thumbInFlight check → red “a tile wall …” (several previews written)
 *   B  the cache path awaits createProxyPreview instead of queueThumb → red “the request does not wait …”
 *      (the preview already exists when the answer arrives)
 *   C  imgUrl() without '&thumb=1' for thumb → red “the UI asks for the preview” (public/js/images.js)
 *   D  THUMB_MAX_PARALLEL 4 → red “one preview at a time …” (several running)
 *   E  THUMB_MAX_QUEUE removed from queueThumb → red the same test (more than 40 waiting)
 *   F  attemptsLock with pg_advisory_lock (waiting) → red “another process holds the lock …” (it waits)
 *   G  giveLockFree no longer called → red the same test (the lock stays with the preview connection)
 *   H  createMay without `gen !== '0'` → red “gen=0 creates nothing”
 *   I  the catalog tile asks with imgUrl(…, true) instead of 'only' → red “the UI asks for the preview”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-imgthumb-'));
process.env.APP_ROOT = wurzel;
process.env.IMAGE_FETCHES_PER_MINUTE = '1000';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const express = require('express');
const { buildAndRequire, testData, testAccess, replaceServices, testServices } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { httpsStub } = require('./helpers/https-stub');
const { portOf } = require('./helpers/server');
const { bis } = require('./helpers/time');
replaceServices('images', { setNumberInScope: async () => false });

// The preview lock holds its own connection open; recorded so that the test can close it.
const own = [];
const access = testAccess();
const connect = access.ownConnection;
access.ownConnection = async () => {
  const c = await connect.call(access);
  own.push(c);
  return c;
};

const app = express();
app.use((req, _res, next) => {
  /** @type {any} */ (req).session = { userId: 810000 + (process.pid % 100000) };
  next();
});
app.get('/p', (req, res) => _req('routes/imgProxy.js').passThroughImage(testServices(), req, res));
const srv = app.listen(0);
const proxied = u => `http://127.0.0.1:${portOf(srv)}/p?thumb=1&url=${encodeURIComponent(u)}`;

test.after(async () => {
  srv.close();
  for (const c of own) await c.end().catch(() => {});
  await testData()
    .pool?.end?.()
    .catch(() => {});
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('?thumb=1: original at once, the preview once in the background', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const { Jimp } = require(path.join(__dirname, '..', 'node_modules', 'jimp'));
  const imageFile = path.join(wurzel, 'cdn.png');
  await new Jimp({ width: 2400, height: 1800, color: 0x336699ff }).write(imageFile);
  const IMAGE = fs.readFileSync(imageFile);
  await httpsStub(t, (_c, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(IMAGE.length) });
    res.end(IMAGE);
  });
  const u = `https://cdn.rebrickable.com/media/parts/thumb-${process.pid}.png`;
  const { proxyCacheKey } = _req('src/images/images.js');
  const cacheFile = path.join(wurzel, 'data', 'img_proxy_cache', proxyCacheKey(u));
  const thumbFile = `${cacheFile}_thumb.jpg`;
  const renames = [];
  const realRename = fs.promises.rename;
  t.mock.method(fs.promises, 'rename', async (from, to) => {
    renames.push(String(to));
    return realRename.call(fs.promises, from, to);
  });
  const get = () => fetch(proxied(u)).then(async r => Buffer.from(await r.arrayBuffer()));

  const queue = () =>
    require('./helpers/sources')
      .testContext('images')
      .compartments.slot('vorschauen', () => null);
  const drained = () => bis(() => !queue() || (queue().running === 0 && queue()._thumbQueue.length === 0), 10000);
  // The first request fills the disk cache (and queues its own preview, which is removed again).
  assert.ok((await get()).equals(IMAGE));
  assert.ok(await bis(() => fs.existsSync(cacheFile)), 'not cached');
  assert.ok(await drained(), 'the first preview does not finish');
  fs.rmSync(thumbFile, { force: true });
  renames.length = 0;

  await t.test('the request does not wait for the preview', async () => {
    assert.ok((await get()).equals(IMAGE), 'the answer is not the original');
    assert.equal(fs.existsSync(thumbFile), false, 'the answer waited for the preview');
  });
  await t.test('a tile wall starts the preview only once', async () => {
    await Promise.all(Array.from({ length: 6 }, get));
    assert.ok(await bis(() => fs.existsSync(thumbFile), 5000), 'no preview was made');
    // Until the background queue is empty: only then would a second preview have been written.
    const queue = require('./helpers/sources')
      .testContext('images')
      .compartments.slot('vorschauen', () => null);
    assert.ok(await bis(() => queue.running === 0 && queue._thumbQueue.length === 0, 5000), 'the queue does not drain');
    assert.equal(renames.filter(r => r === thumbFile).length, 1, renames.join('\n'));
  });
});

test('the UI asks for the preview', async () => {
  const { openUi, reiter, warte } = require('./helpers/ui');
  const part = {
    part_number: '3001',
    color_id: 5,
    part_name: 'Brick',
    color_name: 'Rot',
    quantity: 1,
    image_url: 'https://cdn.rebrickable.com/media/parts/3001.png',
  };
  const SET = {
    set_number: '10294-1',
    name: 'Titanic',
    year: 2021,
    quantity: 1,
    image_url: 'https://cdn.rebrickable.com/media/sets/10294-1.jpg',
  };
  const { w, d } = await openUi({
    '/v2/parts/manual': { success: true, parts: [part], total: 1, page: 1, page_size: 1 },
    '/v2/sets': { success: true, total: 1, themes: [], sets: [SET] },
    '/v2/catalog/meta': { success: true, themes: [], year_min: 2021, year_max: 2021, year_counts: [] },
    '/v2/catalog/sets': {
      success: true,
      total: 1,
      sets: [{ set_number: '10294-1', name: 'Titanic', year: 2021, image_url: SET.image_url }],
    },
  });
  const src = sel => d.querySelector(sel)?.getAttribute('src') ?? '';
  try {
    assert.ok(
      await warte(() => /img-proxy/.test(src('#gallery img[src*="img-proxy"]'))),
      'gallery without a proxied image',
    );
    assert.match(src('#gallery img[src*="img-proxy"]'), /[?&]thumb=1(?!&gen=0)/, 'the gallery creates previews');
    await reiter(w, 'parts');
    assert.ok(await warte(() => d.querySelector('#manual-parts-list img[src*="img-proxy"]')), 'no proxied image');
    assert.match(src('#manual-parts-list img[src*="img-proxy"]'), /[?&]thumb=1/);
    await reiter(w, 'catalog');
    assert.ok(
      await warte(() => d.querySelector('#catalog-grid img[src*="img-proxy"]')),
      'catalog without a proxied image',
    );
    assert.match(
      src('#catalog-grid img[src*="img-proxy"]'),
      /[?&]thumb=1&gen=0/,
      'the catalog lets previews be computed',
    );
  } finally {
    w.close();
  }
});

test('one preview at a time, at most 40 waiting, gen=0 creates nothing', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const { Jimp } = require(path.join(__dirname, '..', 'node_modules', 'jimp'));
  const dir = path.join(wurzel, 'bulk');
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, 'src.png');
  await new Jimp({ width: 1200, height: 900, color: 0x884422ff }).write(src);
  const queue = () =>
    require('./helpers/sources')
      .testContext('images')
      .compartments.slot('vorschauen', () => null);
  const { queueThumb } = _req('src/images/proxyThumbs.js');
  let most = 0,
    waiting = 0;
  for (let i = 0; i < 60; i++) queueThumb(src, path.join(dir, `t${i}_thumb.jpg`));
  waiting = queue()._thumbQueue.length;
  while (queue().running > 0 || queue()._thumbQueue.length > 0) {
    most = Math.max(most, queue().running);
    await new Promise(r => setImmediate(r));
  }
  assert.equal(most, 1, 'more than one preview at a time');
  assert.ok(waiting <= 40, `${waiting} previews waiting`);
  assert.ok(fs.readdirSync(dir).filter(f => f.endsWith('_thumb.jpg')).length >= 1, 'no preview at all');

  // gen=0: the cached image goes out, nobody computes its preview.
  const u = `https://cdn.rebrickable.com/media/parts/gen0-${process.pid}.png`;
  await httpsStub(t, (_c, res) => {
    const IMAGE = fs.readFileSync(src);
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(IMAGE.length) });
    res.end(IMAGE);
  });
  const { proxyCacheKey } = _req('src/images/images.js');
  const cacheFile = path.join(wurzel, 'data', 'img_proxy_cache', proxyCacheKey(u));
  const gen0 = `http://127.0.0.1:${portOf(srv)}/p?thumb=1&gen=0&url=${encodeURIComponent(u)}`;
  await fetch(gen0).then(r => r.arrayBuffer());
  assert.ok(await bis(() => fs.existsSync(cacheFile)), 'not cached');
  await fetch(gen0).then(r => r.arrayBuffer());
  await bis(() => queue().running === 0 && queue()._thumbQueue.length === 0);
  await t.test('gen=0 creates nothing', () => assert.equal(fs.existsSync(`${cacheFile}_thumb.jpg`), false));
});

test('another process holds the lock: no preview, no waiting; afterwards it is free', {
  concurrency: 1,
  timeout: 20_000,
}, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const { Jimp } = require(path.join(__dirname, '..', 'node_modules', 'jimp'));
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const { createProxyPreview } = _req('src/images/proxyThumbs.js');
  const src = path.join(wurzel, 'lock.png');
  await new Jimp({ width: 400, height: 300, color: 0x2244aaff }).write(src);
  const other = await testData().pool.connect();
  t.after(() => other.release());
  await other.query('SELECT pg_advisory_lock($1)', [LOCKS.PROXY_THUMBS]);
  const started = Date.now();
  assert.equal(await createProxyPreview(src, path.join(wurzel, 'lock1_thumb.jpg')), false);
  assert.ok(Date.now() - started < 2000, 'the preview waited for the lock');
  await other.query('SELECT pg_advisory_unlock($1)', [LOCKS.PROXY_THUMBS]);
  assert.equal(await createProxyPreview(src, path.join(wurzel, 'lock2_thumb.jpg')), true);
  const free = await other.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCKS.PROXY_THUMBS]);
  assert.equal(free.rows[0].ok, true, 'the preview connection kept the lock');
  await other.query('SELECT pg_advisory_unlock($1)', [LOCKS.PROXY_THUMBS]);
});
