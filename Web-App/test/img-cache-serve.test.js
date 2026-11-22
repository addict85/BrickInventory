/**
 * The delivery order of the image proxy — EXECUTED, not read.
 *
 * Counter-check (measured 04.11.2026): imageType() returns the raw value as before
 * as soon as it starts with `image/` and is not SVG → red: “stored as
 * image/png, text/html …”.
 * (11.11.2026) in cacheTreffer() the ETag omitted (`etag: null`) →
 * red: “the service names file, type, length and ETag without sending”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const deliverFromCache = (...a) =>
  _req('src/images/http/imageCacheDelivery.js').deliverFromCache(
    require('./helpers/sources').testServices().images,
    ...a,
  );

/** A res that only records what happened to it. */
function fakeRes() {
  const r = {
    kopf: {},
    status: 200,
    beendet: false,
    streamed: null,
    setHeader(k, v) {
      this.kopf[k.toLowerCase()] = String(v);
    },
    status_(c) {
      this.status = c;
      return this;
    },
    end() {
      this.beendet = true;
      return this;
    },
  };
  /** @type {any} */ (r).status = function (/** @type {number} */ c) {
    this._code = c;
    return this;
  };
  Object.defineProperty(r, 'code', {
    get() {
      return this._code ?? 200;
    },
  });
  return r;
}

/** A call of deliverFromCache with sensible defaults. */
async function ruf(dir, { wantThumb, createMay = true, fresh = false }) {
  const res = fakeRes();
  const streamed = [];
  const noted = [];
  const erledigt = await deliverFromCache({
    res,
    req: { fresh },
    cacheFile: path.join(dir, 'bild'),
    thumbFile: path.join(dir, 'bild_thumb.jpg'),
    wantThumb,
    createMay,
    note: () => noted.push(1),
    streamFileToResponse: (_res, datei) => streamed.push(datei),
  });
  return { erledigt, res, streamed, noted };
}

/** Create a file with `n` bytes. */
function datei(p, n) {
  fs.writeFileSync(p, Buffer.alloc(n, 0x41));
}

test('delivery order of the image cache', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgcache-'));
  const orig = path.join(dir, 'bild');
  const thumb = path.join(dir, 'bild_thumb.jpg');
  const aufraeumen = () => {
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  };

  await t.test('nothing in the cache → the caller has to fetch from the CDN', async () => {
    aufraeumen();
    const { erledigt, streamed } = await ruf(dir, { wantThumb: false });
    assert.equal(erledigt, false, 'false heisst: nicht beantwortet, bitte holen');
    assert.deepEqual(streamed, []);
  });

  await t.test('original there, preview wanted → original IMMEDIATELY, preview reserved', async () => {
    aufraeumen();
    datei(orig, 5000);
    const { erledigt, streamed, res } = await ruf(dir, { wantThumb: true });
    assert.equal(erledigt, true);
    assert.deepEqual(
      streamed,
      [orig],
      'Es darf NICHT auf die Verkleinerung gewartet werden — das war einmal ' +
        'rund 150 ms je Bild und bei einer Kachelwand Sekunden',
    );
    assert.equal(res.kopf['content-length'], '5000');
    assert.match(res.kopf['cache-control'] || '', /max-age=86400/);
  });

  await t.test('preview there → preview instead of original', async () => {
    aufraeumen();
    datei(orig, 5000);
    datei(thumb, 900);
    const { streamed, res } = await ruf(dir, { wantThumb: true });
    assert.deepEqual(streamed, [thumb], 'Die Vorschau hat Vorrang, wenn es sie gibt');
    assert.equal(res.kopf['content-type'], 'image/jpeg');
    assert.equal(res.kopf['content-length'], '900');
  });

  await t.test('preview there, but NOT wanted → original', async () => {
    aufraeumen();
    datei(orig, 5000);
    datei(thumb, 900);
    const { streamed } = await ruf(dir, { wantThumb: false });
    assert.deepEqual(streamed, [orig], 'Ohne ?thumb=1 gehört das Original raus, auch wenn eine Vorschau daliegt');
  });

  await t.test('a stub preview is discarded and the original delivered', async () => {
    // The limit is 200 bytes. An empty or truncated file is
    // not an image — delivered, it would look like a broken box in the browser,
    // and permanently so, because it lies in the cache.
    aufraeumen();
    datei(orig, 5000);
    datei(thumb, 50);
    const { streamed } = await ruf(dir, { wantThumb: true });
    assert.deepEqual(streamed, [orig], 'Die unbrauchbare Vorschau wurde ausgeliefert');
    assert.equal(
      fs.existsSync(thumb),
      false,
      'Die unbrauchbare Vorschau muss gelöscht werden, sonst bleibt sie ewig liegen',
    );
  });

  await t.test('gen=0 computes nothing but only leaves a note', async () => {
    // The REQUEST must not trigger a downscale — that is done by the
    // background job, throttled and only in the primary process.
    aufraeumen();
    datei(orig, 5000);
    const { noted } = await ruf(dir, { wantThumb: true, createMay: false });
    assert.deepEqual(noted, [1], 'Ohne Erzeugungsrecht muss vorgemerkt werden');
  });

  await t.test('known state → 304 and NO image', async () => {
    // The case in which an error almost arose while extracting:
    // `return res.status(304).end()` must not become a mere `res.status(304)`
    // — otherwise the flow would continue and write into an already
    // ended response.
    aufraeumen();
    datei(orig, 5000);
    datei(thumb, 900);

    const v = await ruf(dir, { wantThumb: true, fresh: true });
    assert.equal(v.erledigt, true, '304 ist eine FERTIGE Antwort');
    assert.equal(v.res.code, 304);
    assert.equal(v.res.beendet, true);
    assert.deepEqual(v.streamed, [], 'Bei 304 darf kein Bild mehr rausgehen');

    fs.unlinkSync(thumb);
    const o = await ruf(dir, { wantThumb: false, fresh: true });
    assert.equal(o.erledigt, true);
    assert.equal(o.res.code, 304);
    assert.deepEqual(o.streamed, [], 'Auch der Original-Zweig darf bei 304 nichts senden');
  });

  await t.test('only image types leave the cache', async () => {
    // The Content-Type lies as a file next to it and originally comes from the
    // CDN. An SVG is the only image format that becomes active when opened
    // as a document — it must not be delivered under the own origin,
    // even if an old cache entry claims it.
    for (const [abgelegt, erwartet] of [
      ['image/png', 'image/png'],
      ['image/svg+xml', 'image/jpeg'],
      ['text/html', 'image/jpeg'],
      ['application/pdf', 'image/jpeg'],
      ['image/png, text/html', 'image/jpeg'],
      ['image/webp; charset=binary', 'image/webp'],
      ['image/x-icon', 'image/jpeg'],
    ]) {
      aufraeumen();
      datei(orig, 5000);
      fs.writeFileSync(orig + '.ct', abgelegt);
      const { res } = await ruf(dir, { wantThumb: false });
      assert.equal(
        res.kopf['content-type'],
        erwartet,
        `Abgelegt als ${abgelegt} → ausgeliefert werden muss ${erwartet}`,
      );
    }
  });

  await t.test('the service names file, type, length and ETag without sending', async () => {
    // Sending happens in src/images/http/; the service gets to see no response.
    aufraeumen();
    datei(orig, 5000);
    fs.writeFileSync(orig + '.ct', 'image/png');
    const { cacheHit: cacheTreffer } = _req('src/images/imgCacheServe.js');
    const treffer = await cacheTreffer({
      cacheFile: orig,
      thumbFile: thumb,
      wantThumb: false,
      createMay: false,
      note() {},
    });
    assert.equal(treffer.datei, orig);
    assert.equal(treffer.typ, 'image/png');
    assert.equal(treffer.groesse, 5000);
    assert.match(String(treffer.etag), /^"c-5000-\d+"$/);
    aufraeumen();
    assert.equal(
      await cacheTreffer({ cacheFile: orig, thumbFile: thumb, wantThumb: false, createMay: false, note() {} }),
      null,
    );
  });

  fs.rmSync(dir, { recursive: true, force: true });
});
