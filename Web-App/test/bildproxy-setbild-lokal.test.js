/**
 * Liegt ein Set-Bild samt Vorschau unter images/sets, liefert der Bild-Proxy
 * diese Dateien aus — nicht den eigenen Cache und nicht das CDN. So bekommt
 * die Katalogsuche (Sets ausserhalb des Blickfelds, ohne set_catalog-Zeile)
 * die lokal abgelegten Bilder, obwohl sie die Proxy-Adresse anfragt.
 *
 * Gegenprobe (09.11.2026 gemessen): in bildDurchreichen()
 * (src/katalog/http/bildProxy.ts) die Zeile mit ausSetBildern() gestrichen →
 * rot: „das Original kommt aus images/sets, nicht aus dem Proxy-Cache“ und
 * „mit thumb=1 kommt die lokale Vorschau …“ (je der Inhalt des Caches) sowie
 * „ohne Proxy-Cache und über der Drossel …“ (429 statt 200).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Ein Abruf beim CDN je Minute: Die Probe über der Drossel braucht so kein Netz.
process.env.BILD_ABRUFE_JE_MINUTE = '1';
const _req = require('./helpers/sources').buildAndRequire();

test('Bild-Proxy liefert vorhandene Set-Bilder aus images/sets', async t => {
  const express = require('express');
  const { bildDurchreichen } = _req('src/katalog/http/bildProxy.js');
  const { verdrahteNacharbeit, nacharbeit } = _req('src/auftraege/nacharbeit.js');
  const { proxyAdresse, proxyCacheSchluessel } = _req('src/katalog/bilder/images.js');
  const { DATA_DIR, SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

  const vorher = nacharbeit();
  /** @type {[string, string][]} */
  const notizen = [];
  verdrahteNacharbeit({
    ...vorher,
    bildVormerken: (/** @type {string} */ url, /** @type {string} */ sn) => notizen.push([url, sn]),
  });

  const cacheDir = path.join(DATA_DIR, 'img_proxy_cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  /** @type {string[]} */
  const angelegt = [];
  const lege = (/** @type {string} */ datei, /** @type {Buffer} */ inhalt) => {
    fs.writeFileSync(datei, inhalt);
    angelegt.push(datei);
  };

  const app = express();
  app.get('/p', (req, res) => {
    Object.assign(req, { session: { userId: 1 } });
    return bildDurchreichen(req, res);
  });
  const server = app.listen(0);
  t.after(() => {
    server.close();
    verdrahteNacharbeit(vorher);
    for (const f of angelegt) fs.rmSync(f, { force: true });
  });
  const hole = async (/** @type {string} */ anfrage) => {
    notizen.length = 0;
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const r = await fetch(`http://127.0.0.1:${port}/p?${anfrage}`);
    return { status: r.status, inhalt: Buffer.from(await r.arrayBuffer()) };
  };

  const ORIGINAL = Buffer.alloc(400, 2);
  const VORSCHAU = Buffer.alloc(300, 3);
  const CACHE = Buffer.alloc(500, 4);

  // Wie beim Nutzer: Datei und Vorschau liegen in images/sets, der Proxy-Cache
  // hält nur das Original, ohne eigene Vorschau.
  const mitCache = `5${process.pid}-1`;
  const mitCacheUrl = `https://cdn.rebrickable.com/media/sets/${mitCache}.jpg`;
  lege(path.join(SET_IMAGES_DIR, `${mitCache}.jpg`), ORIGINAL);
  lege(path.join(SET_IMAGES_DIR, `${mitCache}_thumb.jpg`), VORSCHAU);
  const cacheDatei = path.join(cacheDir, proxyCacheSchluessel(proxyAdresse(mitCacheUrl) ?? mitCacheUrl));
  lege(cacheDatei, CACHE);
  lege(`${cacheDatei}.ct`, Buffer.from('image/jpeg'));

  await t.test('das Original kommt aus images/sets, nicht aus dem Proxy-Cache', async () => {
    const r = await hole(`url=${encodeURIComponent(mitCacheUrl)}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.inhalt, ORIGINAL);
  });

  await t.test('mit thumb=1 kommt die lokale Vorschau, ohne Notiz für den Bild-Job', async () => {
    const r = await hole(`url=${encodeURIComponent(mitCacheUrl)}&thumb=1&gen=0`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.inhalt, VORSCHAU);
    assert.deepEqual(notizen, []);
  });

  await t.test('ohne Proxy-Cache und über der Drossel kommt das lokale Bild statt 429', async () => {
    const ohneCache = `4${process.pid}-1`;
    const url = `https://cdn.rebrickable.com/media/sets/${ohneCache}.jpg`;
    lege(path.join(SET_IMAGES_DIR, `${ohneCache}.jpg`), ORIGINAL);
    lege(path.join(SET_IMAGES_DIR, `${ohneCache}_thumb.jpg`), VORSCHAU);
    const { zaehleAnfrage } = _req('src/konto/loginLimiter.js');
    await zaehleAnfrage('bild-abruf', 'konto:1', 60_000);
    await zaehleAnfrage('bild-abruf', 'konto:1', 60_000);
    const r = await hole(`url=${encodeURIComponent(url)}&thumb=1`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.inhalt, VORSCHAU);
  });

  await t.test('fehlt die Vorschau in images/sets, bleibt es beim bisherigen Weg', async () => {
    const halb = `3${process.pid}-1`;
    const url = `https://cdn.rebrickable.com/media/sets/${halb}.jpg`;
    lege(path.join(SET_IMAGES_DIR, `${halb}.jpg`), ORIGINAL);
    const f = path.join(cacheDir, proxyCacheSchluessel(proxyAdresse(url) ?? url));
    lege(f, CACHE);
    lege(`${f}.ct`, Buffer.from('image/jpeg'));
    const r = await hole(`url=${encodeURIComponent(url)}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.inhalt, CACHE);
  });
});
