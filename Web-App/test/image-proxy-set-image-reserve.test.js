/**
 * A set image from Rebrickable that is asked via the proxy is noted by the
 * proxy for the image job: it stores it including preview under images/sets.
 * If both already lie there, and for other images, the note stays out.
 *
 * Counter-check (06.11.2026): in passThroughImage() the line with
 * setImageComplete()/bildVormerken() deleted → red: “a missing
 * set image is noted”.
 * Counter-check (08.11.2026): the call storeAsSetImage() deleted in passThroughImage()
 * → red: “what the proxy has lies under images/sets afterwards”.
 * Counter-checks (09.11.2026): bildVormerken() again before deliverFromCache() and
 * the throttle, without reserveOnce() → red: “one note per set” (3 instead of 1)
 * and “above the throttle the note stays out” (1 instead of 0).
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

test('image proxy reserves set images for images/sets', async t => {
  const express = require('express');
  const passThroughImage = (...a) =>
    _req('src/images/http/imageProxy.js').passThroughImage(require('./helpers/sources').testServices(), ...a);
  const { proxyAddress, proxyCacheKey } = _req('src/images/images.js');
  const { DATA_DIR, SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

  const { notes, end } = require('./helpers/sources').imageNotes();

  const cacheDir = path.join(DATA_DIR, 'img_proxy_cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const created = [];
  const put = (file, content = Buffer.alloc(300, 1)) => {
    fs.writeFileSync(file, content);
    created.push(file);
  };
  /** A cache hit: the proxy then does not ask the CDN. */
  const inCache = url => {
    const f = path.join(cacheDir, proxyCacheKey(proxyAddress(url) ?? url));
    put(f);
    put(`${f}.ct`, Buffer.from('image/jpeg'));
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
  const hole = async url => {
    notes.length = 0;
    const r = await fetch(
      `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/p?url=${encodeURIComponent(url)}`,
    );
    await r.arrayBuffer();
    return r.status;
  };

  const missing = `9${process.pid}-1`,
    located = `8${process.pid}-1`;
  const missingUrl = `https://cdn.rebrickable.com/media/sets/${missing}.jpg`;
  const readUrl = `https://cdn.rebrickable.com/media/sets/${located}.jpg`;
  const partUrl = 'https://cdn.rebrickable.com/media/parts/elements/300121.jpg';
  for (const u of [missingUrl, readUrl, partUrl]) inCache(u);
  put(path.join(SET_IMAGES_DIR, `${located}.jpg`));
  put(path.join(SET_IMAGES_DIR, `${located}_thumb.jpg`));

  await t.test('a missing set image is reserved', async () => {
    assert.equal(await hole(missingUrl), 200);
    assert.deepEqual(notes, [[missingUrl, missing]]);
  });
  await t.test('what the proxy has lies under images/sets afterwards', async () => {
    const stored = path.join(SET_IMAGES_DIR, `${missing}.jpg`);
    created.push(stored);
    assert.equal(await hole(missingUrl), 200);
    assert.deepEqual(
      fs.readFileSync(stored),
      Buffer.alloc(300, 1),
      'what the proxy has is under images/sets afterwards',
    );
    assert.deepEqual(
      fs.readdirSync(SET_IMAGES_DIR).filter(n => n.startsWith(missing) && n.endsWith('.part')),
      [],
      'no half file is left behind',
    );
  });
  await t.test('if image and preview already lie in images/sets, there is no note', async () => {
    assert.equal(await hole(readUrl), 200);
    assert.deepEqual(notes, []);
  });
  await t.test('a part image is not a set image', async () => {
    assert.equal(await hole(partUrl), 200);
    assert.deepEqual(notes, []);
  });
  await t.test('one note per set', async () => {
    const fresh = `7${process.pid}-1`;
    const url = `https://cdn.rebrickable.com/media/sets/${fresh}.jpg`;
    inCache(url);
    created.push(path.join(SET_IMAGES_DIR, `${fresh}.jpg`));
    const all = [];
    for (let i = 0; i < 3; i++) {
      assert.equal(await hole(url), 200);
      all.push(...notes);
    }
    assert.deepEqual(all, [[url, fresh]]);
  });
  await t.test('above the throttle there is no note', async () => {
    const url = `https://cdn.rebrickable.com/media/sets/6${process.pid}-1.jpg`;
    await _req('src/account/loginLimiter.js').countRequest('bild-abruf', 'konto:1', 60_000);
    assert.equal(await hole(url), 429);
    assert.deepEqual(notes, []);
  });
});
