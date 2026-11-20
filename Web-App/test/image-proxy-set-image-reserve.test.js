/**
 * Ein Set-Bild von Rebrickable, das über den Proxy gefragt wird, merkt der
 * Proxy für den Bild-Job vor: Der legt es samt Vorschau unter images/sets ab.
 * Liegen beide schon dort, und bei anderen Bildern, bleibt die Notiz aus.
 *
 * Gegenprobe (06.11.2026): in passThroughImage() die Zeile mit
 * setImageComplete()/bildVormerken() gestrichen → rot: „ein fehlendes
 * Set-Bild wird vorgemerkt“.
 * Gegenprobe (08.11.2026): den Aufruf storeAsSetImage() in passThroughImage()
 * gestrichen → rot: „was der Proxy hat, liegt danach unter images/sets“.
 * Gegenproben (09.11.2026): bildVormerken() wieder vor deliverFromCache() und
 * der Drossel, ohne reserveOnce() → rot: „je Set eine Notiz“ (3 statt 1)
 * und „über der Drossel bleibt die Notiz aus“ (1 statt 0).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Ein Abruf beim CDN je Minute: Die Probe über der Drossel braucht so kein Netz.
process.env.BILD_ABRUFE_JE_MINUTE = '1';
const _req = require('./helpers/sources').buildAndRequire();
// Ohne Datenbank: Die Sets dieser Datei liegen im Blickfeld des Kontos, sonst legt der Proxy nichts ab.
require('./helpers/sources').replaceServices('images', { setNumberInScope: async () => true });

test('image proxy reserves set images for images/sets', async t => {
  const express = require('express');
  const passThroughImage = (...a) =>
    _req('src/images/http/imageProxy.js').passThroughImage(require('./helpers/sources').testServices(), ...a);
  const { proxyAddress, proxyCacheKey } = _req('src/images/images.js');
  const { DATA_DIR, SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

  const { notes, ende } = require('./helpers/sources').imageNotes();

  const cacheDir = path.join(DATA_DIR, 'img_proxy_cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const angelegt = [];
  const put = (datei, inhalt = Buffer.alloc(300, 1)) => {
    fs.writeFileSync(datei, inhalt);
    angelegt.push(datei);
  };
  /** Ein Cache-Treffer: Der Proxy fragt das CDN dann nicht. */
  const imCache = url => {
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
    ende();
    for (const f of angelegt) fs.rmSync(f, { force: true });
  });
  const hole = async url => {
    notes.length = 0;
    const r = await fetch(
      `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/p?url=${encodeURIComponent(url)}`,
    );
    await r.arrayBuffer();
    return r.status;
  };

  const fehlt = `9${process.pid}-1`,
    liegt = `8${process.pid}-1`;
  const missingUrl = `https://cdn.rebrickable.com/media/sets/${fehlt}.jpg`;
  const liesUrl = `https://cdn.rebrickable.com/media/sets/${liegt}.jpg`;
  const teilUrl = 'https://cdn.rebrickable.com/media/parts/elements/300121.jpg';
  for (const u of [missingUrl, liesUrl, teilUrl]) imCache(u);
  put(path.join(SET_IMAGES_DIR, `${liegt}.jpg`));
  put(path.join(SET_IMAGES_DIR, `${liegt}_thumb.jpg`));

  await t.test('a missing set image is reserved', async () => {
    assert.equal(await hole(missingUrl), 200);
    assert.deepEqual(notes, [[missingUrl, fehlt]]);
  });
  await t.test('what the proxy has lies under images/sets afterwards', async () => {
    const abgelegt = path.join(SET_IMAGES_DIR, `${fehlt}.jpg`);
    angelegt.push(abgelegt);
    assert.equal(await hole(missingUrl), 200);
    assert.deepEqual(
      fs.readFileSync(abgelegt),
      Buffer.alloc(300, 1),
      'was der Proxy hat, liegt danach unter images/sets',
    );
    assert.deepEqual(
      fs.readdirSync(SET_IMAGES_DIR).filter(n => n.startsWith(fehlt) && n.endsWith('.teil')),
      [],
      'keine halbe Datei bleibt liegen',
    );
  });
  await t.test('if image and preview already lie in images/sets, there is no note', async () => {
    assert.equal(await hole(liesUrl), 200);
    assert.deepEqual(notes, []);
  });
  await t.test('a part image is not a set image', async () => {
    assert.equal(await hole(teilUrl), 200);
    assert.deepEqual(notes, []);
  });
  await t.test('one note per set', async () => {
    const neu = `7${process.pid}-1`;
    const url = `https://cdn.rebrickable.com/media/sets/${neu}.jpg`;
    imCache(url);
    angelegt.push(path.join(SET_IMAGES_DIR, `${neu}.jpg`));
    const alle = [];
    for (let i = 0; i < 3; i++) {
      assert.equal(await hole(url), 200);
      alle.push(...notes);
    }
    assert.deepEqual(alle, [[url, neu]]);
  });
  await t.test('above the throttle there is no note', async () => {
    const url = `https://cdn.rebrickable.com/media/sets/6${process.pid}-1.jpg`;
    await _req('src/account/loginLimiter.js').countRequest('bild-abruf', 'konto:1', 60_000);
    assert.equal(await hole(url), 429);
    assert.deepEqual(notes, []);
  });
});
