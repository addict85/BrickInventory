/**
 * Ein Set-Bild von Rebrickable, das über den Proxy gefragt wird, merkt der
 * Proxy für den Bild-Job vor: Der legt es samt Vorschau unter images/sets ab.
 * Liegen beide schon dort, und bei anderen Bildern, bleibt die Notiz aus.
 *
 * Gegenprobe (06.11.2026): in bildDurchreichen() die Zeile mit
 * setBildVollstaendig()/bildVormerken() gestrichen → rot: „ein fehlendes
 * Set-Bild wird vorgemerkt“.
 * Gegenprobe (08.11.2026): den Aufruf alsSetBildAblegen() in bildDurchreichen()
 * gestrichen → rot: „was der Proxy hat, liegt danach unter images/sets“.
 * Gegenproben (09.11.2026): bildVormerken() wieder vor liefereAusCache() und
 * der Drossel, ohne vormerkenEinmal() → rot: „je Set eine Notiz“ (3 statt 1)
 * und „über der Drossel bleibt die Notiz aus“ (1 statt 0).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Ein Abruf beim CDN je Minute: Die Probe über der Drossel braucht so kein Netz.
process.env.BILD_ABRUFE_JE_MINUTE = '1';
const _req = require('./helpers/sources').buildAndRequire();

test('Bild-Proxy merkt Set-Bilder für images/sets vor', async t => {
  const express = require('express');
  const { bildDurchreichen } = _req('src/katalog/http/bildProxy.js');
  // Ein Objekt für alle Bereiche (test/helpers/sources.js): die Methode darin ersetzen.
  const nacharbeit = _req('src/infra/bereich.js').prozessDienste().katalog.nacharbeit;
  const { proxyAdresse, proxyCacheSchluessel } = _req('src/katalog/bilder/images.js');
  const { DATA_DIR, SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

  const vorher = nacharbeit.bildVormerken;
  const notizen = [];
  nacharbeit.bildVormerken = (url, sn) => notizen.push([url, sn]);

  const cacheDir = path.join(DATA_DIR, 'img_proxy_cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const angelegt = [];
  const lege = (datei, inhalt = Buffer.alloc(300, 1)) => {
    fs.writeFileSync(datei, inhalt);
    angelegt.push(datei);
  };
  /** Ein Cache-Treffer: Der Proxy fragt das CDN dann nicht. */
  const imCache = url => {
    const f = path.join(cacheDir, proxyCacheSchluessel(proxyAdresse(url) ?? url));
    lege(f);
    lege(`${f}.ct`, Buffer.from('image/jpeg'));
  };

  const app = express();
  app.get('/p', (req, res) => {
    Object.assign(req, { session: { userId: 1 } });
    return bildDurchreichen(req, res);
  });
  const server = app.listen(0);
  t.after(() => {
    server.close();
    nacharbeit.bildVormerken = vorher;
    for (const f of angelegt) fs.rmSync(f, { force: true });
  });
  const hole = async url => {
    notizen.length = 0;
    const r = await fetch(
      `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/p?url=${encodeURIComponent(url)}`,
    );
    await r.arrayBuffer();
    return r.status;
  };

  const fehlt = `9${process.pid}-1`,
    liegt = `8${process.pid}-1`;
  const fehltUrl = `https://cdn.rebrickable.com/media/sets/${fehlt}.jpg`;
  const liegtUrl = `https://cdn.rebrickable.com/media/sets/${liegt}.jpg`;
  const teilUrl = 'https://cdn.rebrickable.com/media/parts/elements/300121.jpg';
  for (const u of [fehltUrl, liegtUrl, teilUrl]) imCache(u);
  lege(path.join(SET_IMAGES_DIR, `${liegt}.jpg`));
  lege(path.join(SET_IMAGES_DIR, `${liegt}_thumb.jpg`));

  await t.test('ein fehlendes Set-Bild wird vorgemerkt', async () => {
    assert.equal(await hole(fehltUrl), 200);
    assert.deepEqual(notizen, [[fehltUrl, fehlt]]);
  });
  await t.test('was der Proxy hat, liegt danach unter images/sets', async () => {
    const abgelegt = path.join(SET_IMAGES_DIR, `${fehlt}.jpg`);
    angelegt.push(abgelegt);
    assert.equal(await hole(fehltUrl), 200);
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
  await t.test('liegen Bild und Vorschau schon in images/sets, bleibt die Notiz aus', async () => {
    assert.equal(await hole(liegtUrl), 200);
    assert.deepEqual(notizen, []);
  });
  await t.test('ein Teilebild ist kein Set-Bild', async () => {
    assert.equal(await hole(teilUrl), 200);
    assert.deepEqual(notizen, []);
  });
  await t.test('je Set eine Notiz', async () => {
    const neu = `7${process.pid}-1`;
    const url = `https://cdn.rebrickable.com/media/sets/${neu}.jpg`;
    imCache(url);
    angelegt.push(path.join(SET_IMAGES_DIR, `${neu}.jpg`));
    const alle = [];
    for (let i = 0; i < 3; i++) {
      assert.equal(await hole(url), 200);
      alle.push(...notizen);
    }
    assert.deepEqual(alle, [[url, neu]]);
  });
  await t.test('über der Drossel bleibt die Notiz aus', async () => {
    const url = `https://cdn.rebrickable.com/media/sets/6${process.pid}-1.jpg`;
    await _req('src/konto/loginLimiter.js').zaehleAnfrage('bild-abruf', 'konto:1', 60_000);
    assert.equal(await hole(url), 429);
    assert.deepEqual(notizen, []);
  });
});
