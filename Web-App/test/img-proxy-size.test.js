/**
 * Grosse CDN-Bilder landen im Cache und bekommen eine Vorschau; erst über der
 * gemeinsamen Grenze (SET_IMG_MAX_BYTES, für Proxy und lokalen Download
 * gleich) wird verworfen — mit Spur in der Konsole und der Fehlerzählung.
 * Das CDN ist eine Attrappe von https.get, APP_ROOT ein eigener Ordner.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, dist neu gebaut):
 *   A  in bildProxy.ts PROXY_CACHE_MAX_BYTES auf 5 MB → rot: „ein Bild genau an
 *      der Grenze …“ und „ein Bild über der Grenze …“
 *   B  in verwirf() console.error → console.log bzw. `imgProxyFailures.other++`
 *      entfernt → rot: „ein Bild über der Grenze …“ (ohne Content-Length)
 *   C  in setImages.ts das console.error beim Grund 'zu-gross' entfernt → rot:
 *      „der lokale Download …“
 *   D  in bildProxy.ts queueThumb(…) vor das rename gezogen → rot: „die
 *      Vorschau entsteht …“ (die Quelldatei gibt es noch nicht)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-bildgrenze-'));
process.env.APP_ROOT = wurzel;
process.env.BILD_ABRUFE_JE_MINUTE = '1000';
const express = require('express');
const sharp = require('sharp');
const { buildAndRequire, testDaten, testZugang } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { bis } = require('./helpers/zeit');
const { bildDurchreichen } = _req('routes/imgProxy.js');
const { SET_IMG_MAX_BYTES, downloadSetImage } = _req('src/katalog/bilder/setImages.js');
const { imgProxyFailures } = _req('src/katalog/bilder/imgProxyStats.js');
const cacheDir = path.join(wurzel, 'data', 'img_proxy_cache');

fs.mkdirSync(path.join(wurzel, 'data', 'images', 'sets'), { recursive: true });

let cdnRumpf = Buffer.alloc(300, 7);
let mitLaenge = true;
const echt = https.get;
https.get = /** @type {typeof https.get} */ (
  /** @type {unknown} */ (
    (/** @type {unknown} */ _url, /** @type {unknown} */ _o, /** @type {(r: unknown) => void} */ cb) => {
      const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => {} });
      const rumpf = cdnRumpf;
      // In Stücken wie ein echter Strom: Die Grenze greift mitten im Lesen.
      const stuecke = [];
      for (let i = 0; i < rumpf.length; i += 1 << 20) stuecke.push(rumpf.subarray(i, i + (1 << 20)));
      setImmediate(() =>
        cb(
          Object.assign(Readable.from(stuecke), {
            statusCode: 200,
            headers: { 'content-type': 'image/jpeg', ...(mitLaenge ? { 'content-length': String(rumpf.length) } : {}) },
          }),
        ),
      );
      return req;
    }
  )
);

// Die Vorschau-Sperre hält eine eigene Verbindung; mitgeschrieben, damit der Test sie schliesst.
const eigene = [];
const standard = testZugang();
const verbinde = standard.eigeneVerbindung;
standard.eigeneVerbindung = async () => {
  const c = await verbinde();
  eigene.push(c);
  return c;
};

const app = express();
let konto = 0;
app.use((req, _res, next) => {
  Object.assign(req, { session: { userId: 500000 + (konto++ % 1000) } });
  next();
});
app.get('/p', bildDurchreichen);
const srv = app.listen(0);
const hole = (adresse, thumb = false) =>
  fetch(
    `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}/p?url=${encodeURIComponent(adresse)}${thumb ? '&thumb=1' : ''}`,
  )
    .then(async r => ({ status: r.status, n: (await r.arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength }))
    .catch(e => ({ status: 0, n: 0, fehler: e }));
const imCache = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []);
const adresse = name => `https://cdn.rebrickable.com/media/parts/elements/${name}-${process.pid}.jpg`;

/** Fängt console.error während `arbeit` ab. */
async function mitFehlern(arbeit) {
  const zeilen = [];
  const e = console.error;
  console.error = (...a) => zeilen.push(a.join(' '));
  try {
    await arbeit();
  } finally {
    console.error = e;
  }
  return zeilen;
}

test.after(async () => {
  https.get = echt;
  srv.close();
  for (const c of eigene) await c.end().catch(() => {});
  await testDaten()
    .pool?.end?.()
    .catch(() => {});
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('ein Bild genau an der Grenze geht hinaus und in den Cache', async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  assert.ok(SET_IMG_MAX_BYTES >= 10 * 1024 * 1024, 'hochauflösende Katalogbilder (5 MB und mehr) fielen heraus');
  cdnRumpf = Buffer.alloc(SET_IMG_MAX_BYTES, 3);
  const r = await hole(adresse('grenze'));
  assert.deepEqual([r.status, r.n], [200, SET_IMG_MAX_BYTES]);
  assert.ok(
    await bis(() =>
      imCache().some(f => /^[0-9a-f]{40}$/.test(f) && fs.statSync(path.join(cacheDir, f)).size === SET_IMG_MAX_BYTES),
    ),
    'nicht im Cache',
  );
});

test('ein Bild über der Grenze wird verworfen, gezählt und gemeldet', async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  cdnRumpf = Buffer.alloc(SET_IMG_MAX_BYTES + 1, 4);
  const vorherCache = imCache().length;
  // Mit Content-Length lehnt schon der Abruf ab; ohne zählt der Strom mit und bricht ab.
  /** @type {Array<{ laenge: boolean, zaehler: 'error' | 'other', meldung: RegExp }>} */
  const faelle = [
    { laenge: true, zaehler: 'error', meldung: /Antwort über 20971520 Byte/ },
    { laenge: false, zaehler: 'other', meldung: /Antwort über 20971520 Byte.*weder gecacht/ },
  ];
  for (const { laenge, zaehler, meldung } of faelle) {
    mitLaenge = laenge;
    const vorher = imgProxyFailures[zaehler];
    const zeilen = await mitFehlern(async () => {
      await hole(adresse(`zugross-${laenge}`));
      await bis(() => imgProxyFailures[zaehler] > vorher);
    });
    assert.equal(imgProxyFailures[zaehler] - vorher, 1, `Content-Length ${laenge}: nicht in der Fehlerzählung`);
    assert.ok(
      zeilen.some(z => meldung.test(z)),
      `Content-Length ${laenge}:\n${zeilen.join('\n')}`,
    );
  }
  mitLaenge = true;
  assert.equal(imCache().length, vorherCache, 'etwas liegt im Cache');
});

test('der lokale Download verwirft dasselbe Bild und meldet es', async () => {
  cdnRumpf = Buffer.alloc(SET_IMG_MAX_BYTES + 1, 5);
  let pfad = 'unberührt';
  const zeilen = await mitFehlern(async () => {
    pfad = await downloadSetImage(adresse('lokal'), '99999-1');
  });
  assert.equal(pfad, null);
  assert.ok(
    zeilen.some(z => /99999-1: Bild grösser als 20 MB/.test(z)),
    zeilen.join('\n'),
  );
  cdnRumpf = Buffer.alloc(SET_IMG_MAX_BYTES, 5);
  assert.equal(
    await downloadSetImage(adresse('lokal2'), '99998-1'),
    '/images/sets/99998-1.jpg',
    'an der Grenze nicht gespeichert',
  );
});

test('die Vorschau entsteht aus dem fertig geschriebenen Cache', async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  cdnRumpf = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#36c' } })
    .jpeg()
    .toBuffer();
  const r = await hole(adresse('vorschau'), true);
  assert.deepEqual([r.status, r.n], [200, cdnRumpf.length], 'zuerst geht das Original hinaus');
  assert.ok(await bis(() => imCache().some(f => f.endsWith('_thumb.jpg')), 10_000), 'keine Vorschau entstanden');
  const vorschau = imCache().find(f => f.endsWith('_thumb.jpg'));
  assert.equal((await sharp(path.join(cacheDir, vorschau)).metadata()).width, 200);
});
