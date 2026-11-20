/**
 * Bild-Proxy (routes/imgProxy.ts) gegen Platten- und Bandbreitenmissbrauch:
 * Zeitstempel im Anfrageteil der CDN-Adressen ergeben keinen neuen
 * Cache-Eintrag, CDN-Abrufe sind je Konto gedrosselt, und der Cache wird
 * gedeckelt, älteste Nutzung zuerst. Das CDN ist eine Attrappe von https.get,
 * APP_ROOT ein eigener Ordner — der Deckel löscht sonst fremde Testdateien.
 *
 * Gegenproben (am 01.11.2026 gemessen):
 *   A  in imgProxy.ts `url = proxyAddress(url) ?? url` entfernt → rot:
 *      „ein Zeitstempel im Anfrageteil holt das Bild nicht neu"
 *   B  die Drossel in passThroughImage auskommentiert → rot: „das vierte
 *      fremde Bild wird gedrosselt"
 *   C  in cleanImageCacheOn die Sortierung umgedreht (neueste zuerst) → rot:
 *      „der Deckel löscht das am längsten unbenutzte Bild"
 *   D  Cache-Control des gestreamten Wegs wieder `public` → rot: „ein
 *      Zeitstempel …“ (private fehlt)
 *   E  in passThroughImage wieder den rohen Content-Type des CDN gesetzt →
 *      rot: „eine Komma-Liste im Content-Type …“ (04.11.2026)
 * Gegenproben (am 08.11.2026 gemessen):
 *   F  die Typprüfung in passThroughImage lässt SVG durch → rot: „nur Bilder
 *      verlassen den Bild-Proxy“
 *   G  fromCdn antwortet auf 404 mit `res.status(404)` statt sendPlaceholder
 *      → rot: „ein fehlendes Bild kommt als Platzhalter …“; rememberMissing()
 *      entfernt → ebenda rot (zweiter Abruf beim CDN)
 *   H  auch 403 wird gemerkt (`r.status === 404 || r.status === 403`) → rot:
 *      „nur 404 wird gemerkt, kein 403“
 *   I  in fromCdn `imgProxyFailures.notFound++` bzw. `.error++` gestrichen → rot:
 *      „Fehler werden gezählt und protokolliert“; ebenso die Meldung
 *      „CDN antwortete …“ auf console.info statt console.error bei 403
 *   J  in bildProbe() `looks_like` ohne den JPEG-Zweig bzw. die Probe ohne
 *      'Accept-Encoding': 'identity' → rot: „die Probe zeigt, WAS …“
 *   K  (15.11.2026) in cleanImageCacheOn() die Schleife über images/sets gestrichen →
 *      rot: „images/sets zählt im Deckel mit …“ (0 statt 1 gelöscht)
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
// Der Platzhalter für fehlende Bilder liegt unter APP_ROOT/public.
fs.mkdirSync(path.join(wurzel, 'public', 'assets'), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, '..', 'public', 'assets', 'set-placeholder.svg'),
  path.join(wurzel, 'public', 'assets', 'set-placeholder.svg'),
);
process.env.BILD_ABRUFE_JE_MINUTE = '3';
const express = require('express');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { warte: pause, bis } = require('./helpers/time');
const { portOf } = require('./helpers/server');
// Ohne Datenbank: Kein Set liegt im Blickfeld, abgelegt wird nichts.
require('./helpers/sources').replaceServices('images', { setNumberInScope: async () => false });
const passThroughImage = (...a) =>
  _req('routes/imgProxy.js').passThroughImage(require('./helpers/sources').testServices(), ...a);
const { cleanImageCacheOn } = _req('src/images/imgCacheServe.js');
const cacheDir = path.join(wurzel, 'data', 'img_proxy_cache');

const geholt = [];
const kopfzeilen = [];
let cdnType = 'image/png';
let cdnStatus = 200;
let cdnBody = Buffer.alloc(300, 7);
let cdnHeader = {};
let cdnNetworkError = false;
const echt = https.get;
/** @type {any} */ (https).get = (url, o, cb) => {
  geholt.push(String(url));
  kopfzeilen.push(o?.headers ?? {});
  const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => {} });
  const bild = cdnBody;
  if (cdnNetworkError) {
    setImmediate(() => req.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })));
    return req;
  }
  setImmediate(() =>
    cb(
      Object.assign(Readable.from([bild]), {
        statusCode: cdnStatus,
        headers: { 'content-type': cdnType, 'content-length': String(bild.length), ...cdnHeader },
      }),
    ),
  );
  return req;
};

const app = express();
let konto = 0;
app.use((req, _res, next) => {
  /** @type {any} */ (req).session = { userId: konto };
  next();
});
app.get('/p', passThroughImage);
const srv = app.listen(0);
const basis = `http://127.0.0.1:${portOf(srv)}/p?url=`;
const hole = adresse =>
  fetch(basis + encodeURIComponent(adresse)).then(async r => ({
    status: r.status,
    n: (await r.arrayBuffer()).byteLength,
    cache: r.headers.get('cache-control'),
  }));
// Der Cache schreibt nach der Antwort; gewartet wird auf die Dateien, nicht auf eine feste Zeit.
const imagesInCache = () =>
  fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(f => /^[0-9a-f]{40}$/.test(f)).length : 0;

test.after(async () => {
  https.get = echt;
  srv.close();
  await testData()
    .pool?.end?.()
    .catch(() => {});
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('ein Zeitstempel im Anfrageteil holt das Bild nicht neu', async () => {
  konto = 700000 + (process.pid % 100000);
  geholt.length = 0;
  const a = await hole('https://cdn.rebrickable.com/media/sets/10294-1.jpg?1700000000');
  assert.equal(a.status, 200);
  assert.ok(await bis(() => imagesInCache() >= 1), 'das erste Bild landet nicht im Cache');
  const b = await hole('https://cdn.rebrickable.com/media/sets/10294-1.jpg?1800000000#x');
  assert.equal(b.status, 200);
  // Nur für Angemeldete: Ein geteilter Zwischenspeicher darf die Antwort nicht halten.
  assert.match(`${a.cache} ${b.cache}`, /^private,.* private,/);
  assert.deepEqual(geholt, ['https://cdn.rebrickable.com/media/sets/10294-1.jpg']);
  // Wo der Anfrageteil das Bild bestimmt, bleibt er — sortiert.
  await hole('https://www.bricklink.com/getPic.asp?itemNo=3001&colorID=5');
  assert.equal(geholt.at(-1), 'https://www.bricklink.com/getPic.asp?colorID=5&itemNo=3001');
  await bis(() => imagesInCache() >= 2);
  assert.equal(imagesInCache(), 2);
});

test('das vierte fremde Bild wird gedrosselt, Treffer und andere Konten nicht', async () => {
  konto = 600000 + (process.pid % 100000);
  for (let i = 1; i <= 3; i++)
    assert.equal((await hole(`https://cdn.rebrickable.com/media/parts/d${i}.png`)).status, 200);
  const vierte = await fetch(basis + encodeURIComponent('https://cdn.rebrickable.com/media/parts/d4.png'));
  assert.equal(vierte.status, 429);
  assert.ok(Number(vierte.headers.get('retry-after')) > 0);
  assert.ok(await bis(() => imagesInCache() >= 5), 'd1 bis d3 landen nicht im Cache');
  assert.equal((await hole('https://cdn.rebrickable.com/media/parts/d1.png')).status, 200, 'Cache-Treffer gedrosselt');
  konto += 1;
  assert.equal((await hole('https://cdn.rebrickable.com/media/parts/d4.png')).status, 200, 'anderes Konto gedrosselt');
  // Der Cache schreibt nach der Antwort weiter; landet die Datei erst im
  // nächsten Test, zählt sie dort gegen den Deckel (im Volllauf so gesehen).
  const bilder = () => fs.readdirSync(cacheDir).filter(f => /^[0-9a-f]{40}$/.test(f)).length;
  for (const ende = Date.now() + 5000; bilder() < 6 && Date.now() < ende; ) await pause(100);
  assert.equal(bilder(), 6);
});

test('eine Komma-Liste im Content-Type des CDN geht nicht hinaus', async () => {
  konto = 500000 + (process.pid % 100000);
  const typ = async (cdn, adresse) => {
    cdnType = cdn;
    const r = await fetch(basis + encodeURIComponent(adresse));
    await r.arrayBuffer();
    return [r.status, r.headers.get('content-type')];
  };
  try {
    assert.deepEqual(await typ('image/png, text/html', 'https://cdn.rebrickable.com/media/parts/k1.png'), [
      200,
      'image/jpeg',
    ]);
    assert.deepEqual(await typ('image/webp; q=1', 'https://cdn.rebrickable.com/media/parts/k2.webp'), [
      200,
      'image/webp',
    ]);
  } finally {
    cdnType = 'image/png';
  }
  // Der Cache schreibt nach der Antwort weiter; der Deckel unten zählt sonst mit.
  for (
    const ende = Date.now() + 5000;
    fs.readdirSync(cacheDir).filter(f => f.endsWith('.ct')).length < 8 && Date.now() < ende;
  )
    await pause(100);
});

test('nur Bilder verlassen den Bild-Proxy', async () => {
  // Auf den erlaubten CDNs liegen teils Nutzer-Uploads; HTML oder SVG liefe
  // sonst unter unserer Herkunft.
  konto = 400000 + (process.pid % 100000);
  try {
    for (const [typ, adresse] of [
      ['text/html', 'h1.png'],
      ['image/svg+xml', 's1.svg'],
      ['application/octet-stream', 'o1.png'],
    ]) {
      cdnType = typ;
      const r = await fetch(basis + encodeURIComponent(`https://cdn.rebrickable.com/media/parts/${adresse}`));
      await r.arrayBuffer();
      assert.equal(r.status, 415, `${typ} ging als Bild hinaus`);
    }
  } finally {
    cdnType = 'image/png';
  }
});

test('ein fehlendes Bild kommt als Platzhalter, und der Server merkt es sich', async () => {
  konto = 300000 + (process.pid % 100000);
  const platzhalter = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'set-placeholder.svg'));
  const adresse = 'https://cdn.rebrickable.com/media/sets/fehlt-1.jpg';
  cdnStatus = 404;
  try {
    geholt.length = 0;
    const fetchRaw = async () => {
      const r = await fetch(basis + encodeURIComponent(adresse));
      return { status: r.status, typ: r.headers.get('content-type'), rumpf: Buffer.from(await r.arrayBuffer()) };
    };
    const erst = await fetchRaw();
    assert.equal(erst.status, 200, 'Ein 404 des CDN geht als Fehler an den Browser');
    assert.equal(erst.typ, 'image/svg+xml');
    assert.ok(erst.rumpf.equals(platzhalter), 'Ausgeliefert wird nicht der Platzhalter');
    assert.equal(geholt.length, 2, 'Vor dem Aufgeben fragt der Proxy einmal ohne Referer nach');
    const zweit = await fetchRaw();
    assert.ok(zweit.status === 200 && zweit.rumpf.equals(platzhalter));
    assert.equal(geholt.length, 2, 'Das fehlende Bild wird nicht gemerkt — jede Kachel fragt das CDN erneut');
  } finally {
    cdnStatus = 200;
  }
});

test('nur 404 wird gemerkt, kein 403', async () => {
  // 403 ist beim CDN oft nur Drosselung; gemerkt fehlten Bilder, die es gibt.
  konto = 200000 + (process.pid % 100000);
  cdnStatus = 403;
  try {
    geholt.length = 0;
    const adresse = basis + encodeURIComponent('https://cdn.rebrickable.com/media/sets/gesperrt-1.jpg');
    for (let i = 0; i < 2; i++) {
      const r = await fetch(adresse);
      await r.arrayBuffer();
      assert.equal(r.status, 403);
    }
    assert.equal(geholt.length, 4, 'Ein 403 wurde gemerkt — der zweite Abruf ging nicht ans CDN');
  } finally {
    cdnStatus = 200;
  }
});

test('der Deckel löscht das am längsten unbenutzte Bild', async () => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const jetzt = Date.now() / 1000;
  const put = (schluessel, alterDays) => {
    for (const [name, n] of [
      [schluessel, 1000],
      [`${schluessel}.ct`, 9],
      [`${schluessel}_thumb.jpg`, 300],
    ]) {
      const p = path.join(cacheDir, name);
      fs.writeFileSync(p, Buffer.alloc(n));
      fs.utimesSync(p, jetzt - alterDays * 86400, jetzt - alterDays * 86400);
    }
  };
  put('a'.repeat(40), 20);
  put('b'.repeat(40), 10);
  put('c'.repeat(40), 1);
  assert.equal(await cleanImageCacheOn(4000, jetzt * 1000), 0, 'unter der Grenze wird nichts gelöscht');
  assert.equal(await cleanImageCacheOn(3000, jetzt * 1000), 3);
  assert.deepEqual(
    fs
      .readdirSync(cacheDir)
      .map(f => f[0])
      .sort()
      .join(''),
    'bbbccc',
  );
});

test('images/sets zählt im Deckel mit und bleibt stehen', async () => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const sets = path.join(wurzel, 'data', 'images', 'sets');
  fs.mkdirSync(sets, { recursive: true });
  fs.writeFileSync(path.join(sets, '10294-1.jpg'), Buffer.alloc(2000));
  const jetzt = Date.now() / 1000;
  for (const [schluessel, alterDays] of /** @type {[string, number][]} */ ([
    ['a'.repeat(40), 5],
    ['b'.repeat(40), 1],
  ])) {
    const p = path.join(cacheDir, schluessel);
    fs.writeFileSync(p, Buffer.alloc(1000));
    fs.utimesSync(p, jetzt - alterDays * 86400, jetzt - alterDays * 86400);
  }
  // 2000 Bytes im Cache lägen unter 3500, mit images/sets sind es 4000.
  assert.equal(await cleanImageCacheOn(3500, jetzt * 1000), 1);
  assert.deepEqual(fs.readdirSync(cacheDir), ['b'.repeat(40)]);
  assert.deepEqual(fs.readdirSync(sets), ['10294-1.jpg']);
  fs.rmSync(sets, { recursive: true, force: true });
});

test('Fehler werden gezählt und protokolliert', async () => {
  const { imgProxyFailures: f } = _req('src/images/imgProxyStats.js');
  const vorher = { ...f };
  const fehler = [];
  const echtError = console.error;
  console.error = (...a) => fehler.push(a.join(' '));
  try {
    for (const [status, netz, adresse] of /** @type {[number, boolean, string][]} */ ([
      [404, false, 'https://cdn.rebrickable.com/media/sets/zaehl-404.jpg'],
      [403, false, 'https://cdn.rebrickable.com/media/sets/zaehl-403.jpg'],
      [200, true, 'https://cdn.rebrickable.com/media/sets/zaehl-netz.jpg'],
    ])) {
      // Je Abruf ein eigenes Konto: Die Drossel (drei je Minute) soll hier nicht greifen.
      konto = 400000 + status * 1000 + (process.pid % 1000);
      cdnStatus = status;
      cdnNetworkError = netz;
      const r = await fetch(basis + encodeURIComponent(adresse));
      await r.arrayBuffer();
      if (netz) assert.equal(r.status, 502);
    }
  } finally {
    console.error = echtError;
    cdnStatus = 200;
    cdnNetworkError = false;
  }
  assert.deepEqual([f.notFound - vorher.notFound, f.other - vorher.other, f.error - vorher.error], [1, 1, 1]);
  assert.match(f.lastError, /ECONNRESET/);
  assert.ok(
    fehler.some(z => z.includes('CDN antwortete 403') && z.includes('zaehl-403')),
    fehler.join('\n'),
  );
  assert.ok(
    fehler.some(z => z.includes('Verbindungsfehler') && z.includes('ECONNRESET')),
    fehler.join('\n'),
  );
});

test('die Probe zeigt, WAS ausgeliefert wird', async () => {
  const { imageProbe: bildProbe } = _req('src/management/diagnostics.js');
  const adresse = 'https://cdn.rebrickable.com/media/sets/probe-1.jpg';
  try {
    cdnBody = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    kopfzeilen.length = 0;
    const jpeg = await bildProbe(adresse);
    assert.equal(jpeg.body_check.looks_like, 'JPEG');
    assert.match(jpeg.body_check.first_bytes_hex, /^ff d8 ff e0/);
    assert.deepEqual(
      jpeg.probes.map(p => [p.variant, p.status]),
      [
        ['mit Referer', 200],
        ['ohne Referer', 200],
        ['nackt', 200],
      ],
    );
    // Dieselbe Anforderung wie der Proxy: unkomprimiert.
    assert.equal(kopfzeilen.at(-1)['Accept-Encoding'], 'identity');
    assert.equal(typeof jpeg.proxy_failures.notFound, 'number');
    // Ein CDN, das trotzdem komprimiert, fällt in der Antwort auf.
    cdnBody = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]);
    cdnHeader = { 'content-encoding': 'gzip' };
    const gz = await bildProbe(adresse);
    assert.deepEqual([gz.body_check.looks_like, gz.probes[0].content_encoding], ['gzip (komprimiert!)', 'gzip']);
  } finally {
    cdnBody = Buffer.alloc(300, 7);
    cdnHeader = {};
  }
});
