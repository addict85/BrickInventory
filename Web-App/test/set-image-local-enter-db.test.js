/**
 * If a set image lies under images/sets, the server registers it with the set as
 * image_local; only then does the UI load the file instead of the proxy.
 * Both paths: the image job after storing and the proxy when image and
 * preview are already there.
 *
 * Counter-checks (07.11.2026):
 *   A  in src/images/imageDemandRun.ts the call enterSetImageLocal() in the branch
 *      „file already there“ deleted → red: “the image job registers the file”
 *   B  in passThroughImage() the else branch with enterSetImageLocal()
 *      deleted → red: “the proxy registers existing files …”
 * Counter-checks (10.11.2026, catalog sets outside the inventory):
 *   C  in setImageMissing() enterSetImageLocal(setNummer) without a source → red:
 *      “the proxy registers …” (image_url null)
 *   D  rememberSetImageLocal() again as an UPDATE without INSERT … SELECT FROM rb_sets → red:
 *      “the proxy registers …” (a missing set_catalog row stays missing)
 *   E  c.image_local removed from SET_SPALTEN in katalogSuche.ts → red: “… and the
 *      catalog search then names the local address”
 *
 * Counter-check (15.11.2026, event instead of follow-up work):
 *   F  atSetImageLoaded() deleted in createCatalog → red: all three cases
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const { emptyQueue } = require('./helpers/image-queue');
const db = testData();

test('set images in images/sets are registered', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { SET_IMAGES_DIR, DATA_DIR } = _req('src/infra/appPaths.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const created = [];
  const put = (datei, inhalt = Buffer.alloc(300, 1)) => {
    fs.writeFileSync(datei, inhalt);
    created.push(datei);
  };
  const job = `7${process.pid}-1`,
    proxy = `6${process.pid}-1`;
  const cdn = sn => `https://cdn.rebrickable.com/media/sets/${sn}.jpg`;
  for (const sn of [job, proxy]) {
    await catalogSet(db, sn, { name: 'Probe' });
    await db.run(`UPDATE set_catalog SET image_local = NULL, image_url = $2 WHERE set_number = $1`, [sn, cdn(sn)]);
  }
  t.after(async () => {
    for (const f of created) fs.rmSync(f, { force: true });
    await db.run('DELETE FROM rb_sets WHERE set_num = ANY($1)', [[job, proxy]]).catch(() => {});
  });
  const local = async sn =>
    (await db.get('SELECT image_local FROM set_catalog WHERE set_number = $1', [sn]))?.image_local;

  await t.test('the image job registers the file', async () => {
    await emptyQueue(db);
    put(path.join(SET_IMAGES_DIR, `${job}.jpg`));
    put(path.join(SET_IMAGES_DIR, `${job}_thumb.jpg`));
    const IQ = _req('src/images/imageDemandRun.js');
    IQ.rememberUsed(cdn(job), job);
    await IQ._writeBuffer();
    await IQ._workStack();
    assert.equal(await local(job), `/images/sets/${job}.jpg`);
  });

  await t.test('the proxy registers existing files including source, even without a set_catalog row', async () => {
    // A catalog set outside every inventory: rb_sets knows it, set_catalog exceptionally does not.
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [proxy]);
    const express = require('express');
    const passThroughImage = (...a) =>
      _req('src/images/http/imageProxy.js').passThroughImage(require('./helpers/sources').testServices(), ...a);
    const { proxyAddress, proxyCacheKey } = _req('src/images/images.js');
    put(path.join(SET_IMAGES_DIR, `${proxy}.jpg`));
    put(path.join(SET_IMAGES_DIR, `${proxy}_thumb.jpg`));
    // A cache hit: the proxy then does not ask the CDN.
    const cacheDir = path.join(DATA_DIR, 'img_proxy_cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const f = path.join(cacheDir, proxyCacheKey(proxyAddress(cdn(proxy)) ?? cdn(proxy)));
    put(f);
    put(`${f}.ct`, Buffer.from('image/jpeg'));
    const app = express();
    app.get('/p', (req, res) => {
      Object.assign(req, { session: { userId: 1 } });
      return passThroughImage(req, res);
    });
    const server = app.listen(0);
    t.after(() => server.close());
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const r = await fetch(`http://127.0.0.1:${port}/p?url=${encodeURIComponent(cdn(proxy))}`);
    await r.arrayBuffer();
    assert.equal(r.status, 200);
    // Registered without waiting: the delivery does not hang on the write.
    let z;
    for (let i = 0; i < 50; i++) {
      z = await db.get('SELECT image_local, image_url FROM set_catalog WHERE set_number = $1', [proxy]);
      if (z?.image_local) break;
      await new Promise(w => setTimeout(w, 50));
    }
    assert.deepEqual(z, { image_local: `/images/sets/${proxy}.jpg`, image_url: cdn(proxy) });
    // A second fetch writes nothing new.
    const vorher = (await db.get('SELECT updated_at FROM set_catalog WHERE set_number = $1', [proxy])).updated_at;
    await (await fetch(`http://127.0.0.1:${port}/p?url=${encodeURIComponent(cdn(proxy))}`)).arrayBuffer();
    await new Promise(w => setTimeout(w, 200));
    assert.deepEqual(
      (await db.get('SELECT updated_at FROM set_catalog WHERE set_number = $1', [proxy])).updated_at,
      vorher,
    );
  });

  await t.test('… and the catalog search then names the local address', async () => {
    const { catalogPage } = _req('src/catalog/service.js');
    const seite = await catalogPage(1, { q: proxy, themeId: null }, 'num_asc', 1, 10);
    assert.deepEqual(
      seite.sets.map(x => [x.set_number, x.image_local]),
      [[proxy, `/images/sets/${proxy}_thumb.jpg`]],
    );
  });
});
