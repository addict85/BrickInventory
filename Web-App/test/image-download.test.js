/**
 * Images from foreign addresses: what lands under /images/ the server delivers
 * from its own origin. What is checked is downloadImage() itself, with a
 * rebuilt https.get — without network.
 *
 * Counter-checks (measured on 25.10.):
 *   A  hostAllowed check removed in loadImage() → red: “foreign host is fetched"
 *   B  imageTypeAllowed check removed           → red: “SVG stored"
 *   C  filePart() bypassed in downloadImage     → red: “path from the part number"
 *   D  size limit removed                       → red: “oversized image stored"
 *   E  in imageExtension Object.hasOwn replaced by `in` (measured 02.11.)
 *                                               → red: “constructor taken as extension"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const bd = _req('src/images/imageFile.js');
const { downloadImage } = _req('src/catalog/partsEnrichment.js');
const { PART_IMAGES_DIR, DATA_DIR } = _req('src/infra/appPaths.js');

const CDN = 'https://cdn.rebrickable.com/media/parts/elements';
const NUMBER = `bildtest${process.pid}`;

/** Rebuild https.get: counts calls and delivers the predefined response. */
function placeAfter(t, { status = 200, typ = 'image/png', body = Buffer.from('PNGDATEN') } = {}) {
  const aufrufe = [];
  const echt = https.get;
  /** @type {any} */ (https).get = (address, _o, cb) => {
    aufrufe.push(String(address));
    const req = /** @type {any} */ (new EventEmitter());
    req.setTimeout = () => req;
    req.destroy = () => {};
    setImmediate(() => {
      const r = /** @type {any} */ (Readable.from(Array.isArray(body) ? body : [body]));
      r.statusCode = status;
      r.headers = { 'content-type': typ };
      cb(r);
    });
    return req;
  };
  t.after(() => {
    https.get = echt;
  });
  return aufrufe;
}

function aufraeumen() {
  if (!fs.existsSync(PART_IMAGES_DIR)) return;
  for (const f of fs.readdirSync(PART_IMAGES_DIR))
    if (f.startsWith(NUMBER)) fs.rmSync(path.join(PART_IMAGES_DIR, f), { force: true });
}

test('the building blocks', () => {
  assert.equal(bd.imageExtension(`${CDN}/300121.PNG?x=1`), 'png');
  assert.equal(bd.imageExtension('https://cdn.rebrickable.com/a/b.html'), 'jpg', 'Endung aus der Adresse übernommen');
  assert.equal(bd.imageExtension('https://cdn.rebrickable.com/a/b.svg'), 'jpg');
  for (const inherited of ['constructor', 'tostring', '__proto__'])
    assert.equal(
      bd.imageExtension(`https://cdn.rebrickable.com/a/b.${inherited}`),
      'jpg',
      `${inherited} als Endung übernommen`,
    );
  assert.ok(bd.imageTypeAllowed('image/jpeg; charset=binary'));
  for (const typ of ['image/svg+xml', 'text/html', '', undefined])
    assert.equal(bd.imageTypeAllowed(typ), false, `${typ} als Bild erlaubt`);
  for (const gut of ['3001', '973pb0123c01', 'fig-000123', '10294-1', 0, 4])
    assert.equal(bd.filePart(gut), String(gut));
  for (const badOne of ['a/../../x', '../x', 'a..b', '.versteckt', 'a\\b', '', 'x'.repeat(65)])
    assert.equal(bd.filePart(badOne), null, `${badOne} als Dateiname erlaubt`);
  assert.equal(bd.targetInFolder('/a/b', '../c'), null);
  assert.equal(bd.targetInFolder('/a/b', 'c.png'), '/a/b/c.png');
});

test('downloadImage', { concurrency: 1 }, async t => {
  t.after(aufraeumen);

  await t.test('an image from the CDN is saved', async tt => {
    aufraeumen();
    const aufrufe = placeAfter(tt);
    const rel = await downloadImage(`${CDN}/1.png`, NUMBER, 4, 'part');
    assert.equal(rel, `/images/parts/${NUMBER}_4.png`);
    assert.equal(aufrufe.length, 1);
    assert.equal(fs.readFileSync(path.join(PART_IMAGES_DIR, `${NUMBER}_4.png`), 'utf8'), 'PNGDATEN');
    assert.deepEqual(
      fs.readdirSync(PART_IMAGES_DIR).filter(f => f.startsWith(NUMBER) && f.endsWith('.part')),
      [],
    );
  });

  await t.test('foreign host: no fetch', async tt => {
    aufraeumen();
    const aufrufe = placeAfter(tt);
    for (const address of [
      'https://169.254.169.254/latest/meta-data.png',
      'https://localhost/x.png',
      'http://cdn.rebrickable.com/x.png',
      'https://rebrickable.com.boese.example/x.png',
    ])
      assert.equal(await downloadImage(address, NUMBER, 0, 'part'), null, address);
    assert.deepEqual(aufrufe, [], 'fremder Host wird abgerufen');
  });

  await t.test('no image: nothing saved', async tt => {
    for (const typ of ['image/svg+xml', 'text/html']) {
      aufraeumen();
      placeAfter(tt, { typ, body: Buffer.from('<svg onload="alert(1)"/>') });
      assert.equal(await downloadImage(`${CDN}/x.png`, NUMBER, 0, 'part'), null, `${typ} gespeichert`);
      assert.deepEqual(
        fs.readdirSync(PART_IMAGES_DIR).filter(f => f.startsWith(NUMBER)),
        [],
        'SVG gespeichert',
      );
    }
  });

  await t.test('path from the part number: no fetch, no file outside', async tt => {
    const aufrufe = placeAfter(tt);
    const boese = `a/../../../${NUMBER}`;
    tt.after(() => fs.rmSync(path.join(DATA_DIR, `${NUMBER}_0.png`), { force: true }));
    assert.equal(await downloadImage(`${CDN}/x.png`, boese, 0, 'part'), null);
    assert.deepEqual(aufrufe, [], 'Pfad aus der Teilenummer');
    assert.equal(fs.existsSync(path.join(DATA_DIR, `${NUMBER}_0.png`)), false);
  });

  await t.test('too large: aborted, nothing left behind', async tt => {
    aufraeumen();
    const block = Buffer.alloc(1024 * 1024, 1);
    placeAfter(tt, { body: /** @type {any} */ (Array(bd.IMAGE_MAX_BYTES / block.length + 2).fill(block)) });
    assert.equal(await downloadImage(`${CDN}/x.png`, NUMBER, 0, 'part'), null, 'übergrosses Bild gespeichert');
    assert.deepEqual(
      fs.readdirSync(PART_IMAGES_DIR).filter(f => f.startsWith(NUMBER)),
      [],
    );
  });

  await t.test('HTTP 404: nothing saved', async tt => {
    aufraeumen();
    placeAfter(tt, { status: 404, typ: 'text/html' });
    assert.equal(await downloadImage(`${CDN}/x.png`, NUMBER, 0, 'part'), null);
    assert.deepEqual(
      fs.readdirSync(PART_IMAGES_DIR).filter(f => f.startsWith(NUMBER)),
      [],
    );
  });
});
