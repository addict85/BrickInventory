/**
 * Bilder aus fremden Adressen: Was unter /images/ landet, liefert der Server
 * vom eigenen Ursprung aus. Geprüft wird downloadImage() selbst, mit einem
 * nachgestellten https.get — ohne Netz.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  hostErlaubt-Prüfung in ladeBild() entfernt → rot: „fremder Host wird abgerufen"
 *   B  bildTypErlaubt-Prüfung entfernt            → rot: „SVG gespeichert"
 *   C  dateiTeil() in downloadImage umgangen      → rot: „Pfad aus der Teilenummer"
 *   D  Grössengrenze entfernt                     → rot: „übergrosses Bild gespeichert"
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const https  = require('node:https');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const bd = _req('utils/bildDatei.js');
const { downloadImage } = _req('jobs/partsCatalogEnrich.js');
const { PART_IMAGES_DIR, DATA_DIR } = _req('src/infra/appPaths.js');

const CDN = 'https://cdn.rebrickable.com/media/parts/elements';
const NUMMER = `bildtest${process.pid}`;

/** https.get nachstellen: zählt Aufrufe und liefert die vorgegebene Antwort. */
function stelleNach(t, { status = 200, typ = 'image/png', body = Buffer.from('PNGDATEN') } = {}) {
  const aufrufe = [];
  const echt = https.get;
  https.get = (adresse, _o, cb) => {
    aufrufe.push(String(adresse));
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    setImmediate(() => {
      const r = Readable.from(Array.isArray(body) ? body : [body]);
      r.statusCode = status;
      r.headers = { 'content-type': typ };
      cb(r);
    });
    return req;
  };
  t.after(() => { https.get = echt; });
  return aufrufe;
}

function aufraeumen() {
  if (!fs.existsSync(PART_IMAGES_DIR)) return;
  for (const f of fs.readdirSync(PART_IMAGES_DIR))
    if (f.startsWith(NUMMER)) fs.rmSync(path.join(PART_IMAGES_DIR, f), { force: true });
}

test('die Bausteine', () => {
  assert.equal(bd.bildEndung(`${CDN}/300121.PNG?x=1`), 'png');
  assert.equal(bd.bildEndung('https://cdn.rebrickable.com/a/b.html'), 'jpg', 'Endung aus der Adresse übernommen');
  assert.equal(bd.bildEndung('https://cdn.rebrickable.com/a/b.svg'), 'jpg');
  assert.ok(bd.bildTypErlaubt('image/jpeg; charset=binary'));
  for (const typ of ['image/svg+xml', 'text/html', '', undefined])
    assert.equal(bd.bildTypErlaubt(typ), false, `${typ} als Bild erlaubt`);
  for (const gut of ['3001', '973pb0123c01', 'fig-000123', '10294-1', 0, 4])
    assert.equal(bd.dateiTeil(gut), String(gut));
  for (const schlecht of ['a/../../x', '../x', 'a..b', '.versteckt', 'a\\b', '', 'x'.repeat(65)])
    assert.equal(bd.dateiTeil(schlecht), null, `${schlecht} als Dateiname erlaubt`);
  assert.equal(bd.zielImOrdner('/a/b', '../c'), null);
  assert.equal(bd.zielImOrdner('/a/b', 'c.png'), '/a/b/c.png');
});

test('downloadImage', { concurrency: 1 }, async (t) => {
  t.after(aufraeumen);

  await t.test('ein Bild vom CDN wird gespeichert', async (tt) => {
    aufraeumen();
    const aufrufe = stelleNach(tt);
    const rel = await downloadImage(`${CDN}/1.png`, NUMMER, 4, 'part');
    assert.equal(rel, `/images/parts/${NUMMER}_4.png`);
    assert.equal(aufrufe.length, 1);
    assert.equal(fs.readFileSync(path.join(PART_IMAGES_DIR, `${NUMMER}_4.png`), 'utf8'), 'PNGDATEN');
    assert.deepEqual(fs.readdirSync(PART_IMAGES_DIR).filter(f => f.startsWith(NUMMER) && f.endsWith('.teil')), []);
  });

  await t.test('fremder Host: kein Abruf', async (tt) => {
    aufraeumen();
    const aufrufe = stelleNach(tt);
    for (const adresse of ['https://169.254.169.254/latest/meta-data.png', 'https://localhost/x.png',
                           'http://cdn.rebrickable.com/x.png', 'https://rebrickable.com.boese.example/x.png'])
      assert.equal(await downloadImage(adresse, NUMMER, 0, 'part'), null, adresse);
    assert.deepEqual(aufrufe, [], 'fremder Host wird abgerufen');
  });

  await t.test('kein Bild: nichts gespeichert', async (tt) => {
    for (const typ of ['image/svg+xml', 'text/html']) {
      aufraeumen();
      stelleNach(tt, { typ, body: Buffer.from('<svg onload="alert(1)"/>') });
      assert.equal(await downloadImage(`${CDN}/x.png`, NUMMER, 0, 'part'), null, `${typ} gespeichert`);
      assert.deepEqual(fs.readdirSync(PART_IMAGES_DIR).filter(f => f.startsWith(NUMMER)), [], 'SVG gespeichert');
    }
  });

  await t.test('Pfad aus der Teilenummer: kein Abruf, keine Datei ausserhalb', async (tt) => {
    const aufrufe = stelleNach(tt);
    const boese = `a/../../../${NUMMER}`;
    tt.after(() => fs.rmSync(path.join(DATA_DIR, `${NUMMER}_0.png`), { force: true }));
    assert.equal(await downloadImage(`${CDN}/x.png`, boese, 0, 'part'), null);
    assert.deepEqual(aufrufe, [], 'Pfad aus der Teilenummer');
    assert.equal(fs.existsSync(path.join(DATA_DIR, `${NUMMER}_0.png`)), false);
  });

  await t.test('zu gross: abgebrochen, nichts liegen gelassen', async (tt) => {
    aufraeumen();
    const block = Buffer.alloc(1024 * 1024, 1);
    stelleNach(tt, { body: Array(bd.BILD_MAX_BYTES / block.length + 2).fill(block) });
    assert.equal(await downloadImage(`${CDN}/x.png`, NUMMER, 0, 'part'), null, 'übergrosses Bild gespeichert');
    assert.deepEqual(fs.readdirSync(PART_IMAGES_DIR).filter(f => f.startsWith(NUMMER)), []);
  });

  await t.test('HTTP 404: nichts gespeichert', async (tt) => {
    aufraeumen();
    stelleNach(tt, { status: 404, typ: 'text/html' });
    assert.equal(await downloadImage(`${CDN}/x.png`, NUMMER, 0, 'part'), null);
    assert.deepEqual(fs.readdirSync(PART_IMAGES_DIR).filter(f => f.startsWith(NUMMER)), []);
  });
});
