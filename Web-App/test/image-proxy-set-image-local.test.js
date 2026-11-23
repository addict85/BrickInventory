/**
 * If a set image including preview lies under images/sets, the image proxy delivers
 * these files — not its own cache and not the CDN. That way the
 * catalog search (sets outside the view, without a set_catalog row)
 * gets the locally stored images although it requests the proxy address.
 *
 * Counter-check (measured 09.11.2026): in passThroughImage()
 * (src/images/http/imageProxy.ts) the line with fromSetImages() deleted →
 * red: “the original comes from images/sets, not from the proxy cache” and
 * “with thumb=1 the local preview comes …” (each the content of the cache) as well as
 * “without proxy cache and above the throttle …” (429 instead of 200).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// One fetch at the CDN per minute: the probe above the throttle thus needs no network.
process.env.IMAGE_FETCHES_PER_MINUTE = '1';
const _req = require('./helpers/sources').buildAndRequire();
// Without a database: the sets of this file are in the account's view, otherwise the proxy stores nothing.
require('./helpers/sources').replaceServices('images', { setNumberInScope: async () => true });

test('image proxy delivers existing set images from images/sets', async t => {
  const express = require('express');
  const passThroughImage = (...a) =>
    _req('src/images/http/imageProxy.js').passThroughImage(require('./helpers/sources').testServices(), ...a);
  const { proxyAddress, proxyCacheKey } = _req('src/images/images.js');
  const { DATA_DIR, SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

  const { notes, end } = require('./helpers/sources').imageNotes();

  const cacheDir = path.join(DATA_DIR, 'img_proxy_cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  /** @type {string[]} */
  const created = [];
  const put = (/** @type {string} */ file, /** @type {Buffer} */ content) => {
    fs.writeFileSync(file, content);
    created.push(file);
  };

  const app = express();
  app.get('/p', (req, res) => {
    Object.assign(req, { session: { userId: 1 } });
    return passThroughImage(req, res);
  });
  const server = app.listen(0);
  t.after(() => {
    server.close();
    end();
    for (const f of created) fs.rmSync(f, { force: true });
  });
  const hole = async (/** @type {string} */ request) => {
    notes.length = 0;
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const r = await fetch(`http://127.0.0.1:${port}/p?${request}`);
    return { status: r.status, content: Buffer.from(await r.arrayBuffer()) };
  };

  const ORIGINAL = Buffer.alloc(400, 2);
  const PREVIEW = Buffer.alloc(300, 3);
  const CACHE = Buffer.alloc(500, 4);

  // As for the user: file and preview lie in images/sets, the proxy cache
  // only holds the original, without its own preview.
  const withCache = `5${process.pid}-1`;
  const withCacheUrl = `https://cdn.rebrickable.com/media/sets/${withCache}.jpg`;
  put(path.join(SET_IMAGES_DIR, `${withCache}.jpg`), ORIGINAL);
  put(path.join(SET_IMAGES_DIR, `${withCache}_thumb.jpg`), PREVIEW);
  const cacheFile = path.join(cacheDir, proxyCacheKey(proxyAddress(withCacheUrl) ?? withCacheUrl));
  put(cacheFile, CACHE);
  put(`${cacheFile}.ct`, Buffer.from('image/jpeg'));

  await t.test('the original comes from images/sets, not from the proxy cache', async () => {
    const r = await hole(`url=${encodeURIComponent(withCacheUrl)}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.content, ORIGINAL);
  });

  await t.test('with thumb=1 the local preview comes, without a note for the image job', async () => {
    const r = await hole(`url=${encodeURIComponent(withCacheUrl)}&thumb=1&gen=0`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.content, PREVIEW);
    assert.deepEqual(notes, []);
  });

  await t.test('without proxy cache and above the throttle the local image comes instead of 429', async () => {
    const withoutCache = `4${process.pid}-1`;
    const url = `https://cdn.rebrickable.com/media/sets/${withoutCache}.jpg`;
    put(path.join(SET_IMAGES_DIR, `${withoutCache}.jpg`), ORIGINAL);
    put(path.join(SET_IMAGES_DIR, `${withoutCache}_thumb.jpg`), PREVIEW);
    const { countRequest } = _req('src/account/loginLimiter.js');
    await countRequest('bild-abruf', 'konto:1', 60_000);
    await countRequest('bild-abruf', 'konto:1', 60_000);
    const r = await hole(`url=${encodeURIComponent(url)}&thumb=1`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.content, PREVIEW);
  });

  await t.test('if the preview is missing in images/sets, the previous path stays', async () => {
    const half = `3${process.pid}-1`;
    const url = `https://cdn.rebrickable.com/media/sets/${half}.jpg`;
    put(path.join(SET_IMAGES_DIR, `${half}.jpg`), ORIGINAL);
    const f = path.join(cacheDir, proxyCacheKey(proxyAddress(url) ?? url));
    put(f, CACHE);
    put(`${f}.ct`, Buffer.from('image/jpeg'));
    const r = await hole(`url=${encodeURIComponent(url)}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.content, CACHE);
  });
});
