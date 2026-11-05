/**
 * Bild-Proxy (routes/imgProxy.ts) gegen Platten- und Bandbreitenmissbrauch:
 * Zeitstempel im Anfrageteil der CDN-Adressen ergeben keinen neuen
 * Cache-Eintrag, CDN-Abrufe sind je Konto gedrosselt, und der Cache wird
 * gedeckelt, älteste Nutzung zuerst. Das CDN ist eine Attrappe von https.get,
 * APP_ROOT ein eigener Ordner — der Deckel löscht sonst fremde Testdateien.
 *
 * Gegenproben (am 01.11.2026 gemessen):
 *   A  in imgProxy.ts `url = proxyAdresse(url) ?? url` entfernt → rot:
 *      „ein Zeitstempel im Anfrageteil holt das Bild nicht neu"
 *   B  die Drossel in bildDurchreichen auskommentiert → rot: „das vierte
 *      fremde Bild wird gedrosselt"
 *   C  in raeumeBildCacheAuf die Sortierung umgedreht (neueste zuerst) → rot:
 *      „der Deckel löscht das am längsten unbenutzte Bild"
 *   D  Cache-Control des gestreamten Wegs wieder `public` → rot: „ein
 *      Zeitstempel …“ (private fehlt)
 *   E  in bildDurchreichen wieder den rohen Content-Type des CDN gesetzt →
 *      rot: „eine Komma-Liste im Content-Type …“ (04.11.2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');

const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-bildproxy-'));
process.env.APP_ROOT = wurzel;
process.env.BILD_ABRUFE_JE_MINUTE = '3';
const express = require('express');
const _req = require('./helpers/sources').buildAndRequire();
const { warte: pause } = require('./helpers/zeit');
const { bildDurchreichen } = _req('routes/imgProxy.js');
const { raeumeBildCacheAuf } = _req('src/katalog/bilder/imgCacheServe.js');
const cacheDir = path.join(wurzel, 'data', 'img_proxy_cache');

const geholt = [];
let cdnTyp = 'image/png';
const echt = https.get;
https.get = (url, _o, cb) => {
  geholt.push(String(url));
  const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => {} });
  const bild = Buffer.alloc(300, 7);
  setImmediate(() => cb(Object.assign(Readable.from([bild]),
    { statusCode: 200, headers: { 'content-type': cdnTyp, 'content-length': String(bild.length) } })));
  return req;
};

const app = express();
let konto = 0;
app.use((req, _res, next) => { req.session = { userId: konto }; next(); });
app.get('/p', bildDurchreichen);
const srv = app.listen(0);
const basis = `http://127.0.0.1:${srv.address().port}/p?url=`;
const hole = (adresse) => fetch(basis + encodeURIComponent(adresse))
  .then(async r => ({ status: r.status, n: (await r.arrayBuffer()).byteLength, cache: r.headers.get('cache-control') }));

test.after(async () => {
  https.get = echt;
  srv.close();
  await _req('db/database.js').pool?.end?.().catch(() => {});
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('ein Zeitstempel im Anfrageteil holt das Bild nicht neu', async () => {
  konto = 700000 + (process.pid % 100000);
  geholt.length = 0;
  const a = await hole('https://cdn.rebrickable.com/media/sets/10294-1.jpg?1700000000');
  assert.equal(a.status, 200);
  await pause(100);
  const b = await hole('https://cdn.rebrickable.com/media/sets/10294-1.jpg?1800000000#x');
  assert.equal(b.status, 200);
  // Nur für Angemeldete: Ein geteilter Zwischenspeicher darf die Antwort nicht halten.
  assert.match(`${a.cache} ${b.cache}`, /^private,.* private,/);
  assert.deepEqual(geholt, ['https://cdn.rebrickable.com/media/sets/10294-1.jpg']);
  // Wo der Anfrageteil das Bild bestimmt, bleibt er — sortiert.
  await hole('https://www.bricklink.com/getPic.asp?itemNo=3001&colorID=5');
  assert.equal(geholt.at(-1), 'https://www.bricklink.com/getPic.asp?colorID=5&itemNo=3001');
  await pause(100);
  assert.equal(fs.readdirSync(cacheDir).filter(f => /^[0-9a-f]{40}$/.test(f)).length, 2);
});

test('das vierte fremde Bild wird gedrosselt, Treffer und andere Konten nicht', async () => {
  konto = 600000 + (process.pid % 100000);
  for (let i = 1; i <= 3; i++) assert.equal((await hole(`https://cdn.rebrickable.com/media/parts/d${i}.png`)).status, 200);
  const vierte = await fetch(basis + encodeURIComponent('https://cdn.rebrickable.com/media/parts/d4.png'));
  assert.equal(vierte.status, 429);
  assert.ok(Number(vierte.headers.get('retry-after')) > 0);
  await pause(100);
  assert.equal((await hole('https://cdn.rebrickable.com/media/parts/d1.png')).status, 200, 'Cache-Treffer gedrosselt');
  konto += 1;
  assert.equal((await hole('https://cdn.rebrickable.com/media/parts/d4.png')).status, 200, 'anderes Konto gedrosselt');
  // Der Cache schreibt nach der Antwort weiter; landet die Datei erst im
  // nächsten Test, zählt sie dort gegen den Deckel (im Volllauf so gesehen).
  const bilder = () => fs.readdirSync(cacheDir).filter(f => /^[0-9a-f]{40}$/.test(f)).length;
  for (const ende = Date.now() + 5000; bilder() < 6 && Date.now() < ende;) await pause(100);
  assert.equal(bilder(), 6);
});

test('eine Komma-Liste im Content-Type des CDN geht nicht hinaus', async () => {
  konto = 500000 + (process.pid % 100000);
  const typ = async (cdn, adresse) => {
    cdnTyp = cdn;
    const r = await fetch(basis + encodeURIComponent(adresse));
    await r.arrayBuffer();
    return [r.status, r.headers.get('content-type')];
  };
  try {
    assert.deepEqual(await typ('image/png, text/html', 'https://cdn.rebrickable.com/media/parts/k1.png'), [200, 'image/jpeg']);
    assert.deepEqual(await typ('image/webp; q=1', 'https://cdn.rebrickable.com/media/parts/k2.webp'), [200, 'image/webp']);
  } finally { cdnTyp = 'image/png'; }
  // Der Cache schreibt nach der Antwort weiter; der Deckel unten zählt sonst mit.
  for (const ende = Date.now() + 5000; fs.readdirSync(cacheDir).filter(f => f.endsWith('.ct')).length < 8 && Date.now() < ende;) await pause(100);
});

test('der Deckel löscht das am längsten unbenutzte Bild', async () => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const jetzt = Date.now() / 1000;
  const lege = (schluessel, alterTage) => {
    for (const [name, n] of [[schluessel, 1000], [`${schluessel}.ct`, 9], [`${schluessel}_thumb.jpg`, 300]]) {
      const p = path.join(cacheDir, name);
      fs.writeFileSync(p, Buffer.alloc(n));
      fs.utimesSync(p, jetzt - alterTage * 86400, jetzt - alterTage * 86400);
    }
  };
  lege('a'.repeat(40), 20); lege('b'.repeat(40), 10); lege('c'.repeat(40), 1);
  assert.equal(await raeumeBildCacheAuf(4000), 0, 'unter der Grenze wird nichts gelöscht');
  assert.equal(await raeumeBildCacheAuf(3000), 3);
  assert.deepEqual(fs.readdirSync(cacheDir).map(f => f[0]).sort().join(''), 'bbbccc');
});
