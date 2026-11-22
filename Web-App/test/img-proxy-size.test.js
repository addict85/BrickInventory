/**
 * Large CDN images land in the cache and get a preview; only above the
 * shared limit (SET_IMG_MAX_BYTES, the same for proxy and local download)
 * is it discarded — with a trace in the console and the error count.
 * The CDN is a dummy of https.get, APP_ROOT a separate folder.
 *
 * Counter-checks (measured 10.11.2026, each alone, dist rebuilt):
 *   A  in bildProxy.ts PROXY_CACHE_MAX_BYTES to 5 MB → red: “an image exactly at
 *      the limit …” and “an image above the limit …”
 *   B  in verwirf() console.error → console.log or `imgProxyFailures.other++`
 *      removed → red: “an image above the limit …” (without Content-Length)
 *   C  in setImages.ts the console.error for the reason 'zu-gross' removed → red:
 *      “the local download …”
 *   D  in bildProxy.ts queueThumb(…) moved before the rename → red: “the
 *      preview is created …” (the source file does not exist yet)
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
process.env.IMAGE_FETCHES_PER_MINUTE = '1000';
const express = require('express');
const sharp = require('sharp');
const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');
const passThroughImage = (...a) =>
  _req('routes/imgProxy.js').passThroughImage(require('./helpers/sources').testServices(), ...a);
const { SET_IMG_MAX_BYTES, downloadSetImage } = _req('src/images/setImages.js');
const { imgProxyFailures } = _req('src/images/imgProxyStats.js');
const cacheDir = path.join(wurzel, 'data', 'img_proxy_cache');

fs.mkdirSync(path.join(wurzel, 'data', 'images', 'sets'), { recursive: true });

let cdnBody = Buffer.alloc(300, 7);
let withLength = true;
const echt = https.get;
https.get = /** @type {typeof https.get} */ (
  /** @type {unknown} */ (
    (/** @type {unknown} */ _url, /** @type {unknown} */ _o, /** @type {(r: unknown) => void} */ cb) => {
      const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => {} });
      const rumpf = cdnBody;
      // In pieces like a real stream: the limit applies in the middle of reading.
      const stuecke = [];
      for (let i = 0; i < rumpf.length; i += 1 << 20) stuecke.push(rumpf.subarray(i, i + (1 << 20)));
      setImmediate(() =>
        cb(
          Object.assign(Readable.from(stuecke), {
            statusCode: 200,
            headers: {
              'content-type': 'image/jpeg',
              ...(withLength ? { 'content-length': String(rumpf.length) } : {}),
            },
          }),
        ),
      );
      return req;
    }
  )
);

// The preview lock holds its own connection; recorded so that the test closes it.
const eigene = [];
const standard = testAccess();
const connect = standard.ownConnection;
standard.ownConnection = async () => {
  const c = await connect();
  eigene.push(c);
  return c;
};

const app = express();
let konto = 0;
app.use((req, _res, next) => {
  Object.assign(req, { session: { userId: 500000 + (konto++ % 1000) } });
  next();
});
app.get('/p', passThroughImage);
const srv = app.listen(0);
const hole = (address, thumb = false) =>
  fetch(
    `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (srv.address()).port}/p?url=${encodeURIComponent(address)}${thumb ? '&thumb=1' : ''}`,
  )
    .then(async r => ({ status: r.status, n: (await r.arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength }))
    .catch(e => ({ status: 0, n: 0, error: e }));
const imCache = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []);
const address = name => `https://cdn.rebrickable.com/media/parts/elements/${name}-${process.pid}.jpg`;

/** Intercepts console.error while `work` runs. */
async function withErrors(work) {
  const zeilen = [];
  const e = console.error;
  console.error = (...a) => zeilen.push(a.join(' '));
  try {
    await work();
  } finally {
    console.error = e;
  }
  return zeilen;
}

test.after(async () => {
  https.get = echt;
  srv.close();
  for (const c of eigene) await c.end().catch(() => {});
  await testData()
    .pool?.end?.()
    .catch(() => {});
  fs.rmSync(wurzel, { recursive: true, force: true });
});

test('an image exactly at the limit goes out and into the cache', async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  assert.ok(SET_IMG_MAX_BYTES >= 10 * 1024 * 1024, 'hochauflösende Katalogbilder (5 MB und mehr) fielen heraus');
  cdnBody = Buffer.alloc(SET_IMG_MAX_BYTES, 3);
  const r = await hole(address('grenze'));
  assert.deepEqual([r.status, r.n], [200, SET_IMG_MAX_BYTES]);
  assert.ok(
    await bis(() =>
      imCache().some(f => /^[0-9a-f]{40}$/.test(f) && fs.statSync(path.join(cacheDir, f)).size === SET_IMG_MAX_BYTES),
    ),
    'nicht im Cache',
  );
});

test('an image above the limit is discarded, counted and reported', async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  cdnBody = Buffer.alloc(SET_IMG_MAX_BYTES + 1, 4);
  const beforeCache = imCache().length;
  // With Content-Length the fetch already refuses; without it the stream counts along and aborts.
  /** @type {Array<{ laenge: boolean, zaehler: 'error' | 'other', meldung: RegExp }>} */
  const faelle = [
    { laenge: true, zaehler: 'error', meldung: /Antwort über 20971520 Byte/ },
    { laenge: false, zaehler: 'other', meldung: /Antwort über 20971520 Byte.*weder gecacht/ },
  ];
  for (const { laenge, zaehler, meldung } of faelle) {
    withLength = laenge;
    const vorher = imgProxyFailures[zaehler];
    const zeilen = await withErrors(async () => {
      await hole(address(`zugross-${laenge}`));
      await bis(() => imgProxyFailures[zaehler] > vorher);
    });
    assert.equal(imgProxyFailures[zaehler] - vorher, 1, `Content-Length ${laenge}: nicht in der Fehlerzählung`);
    assert.ok(
      zeilen.some(z => meldung.test(z)),
      `Content-Length ${laenge}:\n${zeilen.join('\n')}`,
    );
  }
  withLength = true;
  assert.equal(imCache().length, beforeCache, 'etwas liegt im Cache');
});

test('the local download discards the same image and reports it', async () => {
  cdnBody = Buffer.alloc(SET_IMG_MAX_BYTES + 1, 5);
  let path = 'unberührt';
  const zeilen = await withErrors(async () => {
    path = await downloadSetImage(address('lokal'), '99999-1');
  });
  assert.equal(path, null);
  assert.ok(
    zeilen.some(z => /99999-1: Bild grösser als 20 MB/.test(z)),
    zeilen.join('\n'),
  );
  cdnBody = Buffer.alloc(SET_IMG_MAX_BYTES, 5);
  assert.equal(
    await downloadSetImage(address('lokal2'), '99998-1'),
    '/images/sets/99998-1.jpg',
    'an der Grenze nicht gespeichert',
  );
});

test('the preview arises from the completely written cache', async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  cdnBody = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#36c' } })
    .jpeg()
    .toBuffer();
  const r = await hole(address('vorschau'), true);
  assert.deepEqual([r.status, r.n], [200, cdnBody.length], 'zuerst geht das Original hinaus');
  assert.ok(await bis(() => imCache().some(f => f.endsWith('_thumb.jpg')), 10_000), 'keine Vorschau entstanden');
  const preview = imCache().find(f => f.endsWith('_thumb.jpg'));
  assert.equal((await sharp(path.join(cacheDir, preview)).metadata()).width, 200);
});
