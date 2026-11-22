/**
 * Addendum to UX check 25 in real Chrome: a quantity change in the set detail survives the immediate
 * closing, and the preview of a transparent PNG stays transparent (dark mode).
 *
 * Counter-checks (measured 14.11.2026, each on its own, bundle or dist rebuilt):
 *   A  the pending save again with `if (!offenesSet) return` (state before the addendum) → red: “quantity
 *      saved on immediate close” (mQtyInc lost). Without the observer alone it stays green:
 *      the save then comes 400 ms later, it only makes it immediate.
 *   B  deliverImage() without the type from previewType() → red: “preview of a transparent PNG …” (image/jpeg)
 *   C  verkleinern() without the check isOpaque → red: same place (opaque inside, 255)
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { startApp } = require('./helpers/app-browser');
const { patternCollection, catalogSet, holdsSet, quantityOf } = require('./helpers/inventory');

const ROOT = path.join(__dirname, '..');
const CLOSE = `document.querySelectorAll('.ovl.open [data-dialog-close]').forEach(x => x.click()); true`;

/** 32 × 32 PNG: red border, inside a checkerboard of red and fully transparent. */
function checkerboard() {
  const w = 32,
    h = 32;
  const block = (typ, daten) => {
    const laenge = Buffer.alloc(4);
    laenge.writeUInt32BE(daten.length);
    const inhalt = Buffer.concat([Buffer.from(typ), daten]);
    const pruef = Buffer.alloc(4);
    pruef.writeUInt32BE(zlib.crc32(inhalt));
    return Buffer.concat([laenge, inhalt, pruef]);
  };
  const kopf = Buffer.alloc(13);
  kopf.writeUInt32BE(w, 0);
  kopf.writeUInt32BE(h, 4);
  kopf[8] = 8;
  kopf[9] = 6;
  const roh = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const rand = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      roh.set(rand || (x + y) % 2 === 0 ? [200, 40, 40, 255] : [0, 0, 0, 0], y * (w * 4 + 1) + 1 + x * 4);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    block('IHDR', kopf),
    block('IDAT', zlib.deflateSync(roh)),
    block('IEND', Buffer.alloc(0)),
  ]);
}

async function geh(a, hash, bereit, was) {
  await a.b.auswerten(CLOSE);
  await a.b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
  await a.bis(bereit, was, 200);
  await a.ruhig(5000);
}

async function closeQuantityOn(_t, a) {
  const { b, bis } = a;
  for (const [knopf, soll] of [
    ['mQtyInc', 2],
    ['mQtyDec', 1],
  ]) {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
    await b.auswerten(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
    await bis(`document.getElementById('m-qty')?.value === '${3 - Number(soll)}'`, 'Detail');
    // Change and close in the same move: far below the 400 ms until saving.
    await b.auswerten(`document.querySelector('#set-modal [data-click="${knopf}"]').click();
      document.querySelector('#set-modal [data-dialog-close]').click(); true`);
    await bis(`!document.getElementById('set-modal').classList.contains('open')`, 'geschlossen');
    await a.warte(800);
    await a.ruhig();
    assert.equal(await quantityOf(a.db, [a.uid], '10300-1'), soll, `${knopf} und sofort geschlossen: verloren`);
  }
}

async function transparentPreview(_t, a, nr) {
  const { b, bis } = a;
  await b.auswerten(`document.documentElement.setAttribute('data-dark', ''); true`);
  try {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="${nr}"] .sci img')`, 'Sammlung');
    await bis(
      `(i => i.complete && i.naturalWidth > 0)(document.querySelector('#gallery .sc[data-arg="${nr}"] .sci img'))`,
      'Kachelbild',
    );
    const m =
      await b.auswerten(`(async () => { const i = document.querySelector('#gallery .sc[data-arg="${nr}"] .sci img');
      const r = await fetch(i.currentSrc); const bild = await createImageBitmap(await r.blob());
      const c = document.createElement('canvas'); c.width = bild.width; c.height = bild.height;
      const g = c.getContext('2d'); g.drawImage(bild, 0, 0);
      return { quelle: i.currentSrc.replace(/^.*\\/images\\//, ''), typ: r.headers.get('content-type'),
        rand: g.getImageData(0, 0, 1, 1).data[3], innen: g.getImageData(3, 2, 1, 1).data[3] }; })()`);
    assert.match(m.quelle, /_thumb\.jpg$/, `Testdaten: Kachel zeigt die Vorschau: ${JSON.stringify(m)}`);
    assert.equal(m.typ, 'image/png', `Vorschau mit falschem Typ: ${JSON.stringify(m)}`);
    assert.deepEqual([m.rand, m.innen], [255, 0], `Transparenz ging verloren: ${JSON.stringify(m)}`);
  } finally {
    await b.auswerten(`document.documentElement.removeAttribute('data-dark'); true`);
  }
}

test('quantity on close, PNG preview', { concurrency: 1, timeout: 600_000 }, async t => {
  const nr = `r25b-${process.pid}-1`;
  const req = require('./helpers/sources').buildAndRequire();
  const ordner = path.join(ROOT, 'data', 'images', 'sets');
  t.after(() => {
    for (const d of [`${nr}.jpg`, `${nr}_thumb.jpg`]) fs.rmSync(path.join(ordner, d), { force: true });
  });
  const a = await startApp(t, {
    name: `r25b_${process.pid}`,
    bestand: async (db, uid) => {
      await patternCollection(db, uid);
      // How the app stores set images: <nr>.jpg, next to it the preview from vorschauErzeugenAus.
      fs.mkdirSync(ordner, { recursive: true });
      fs.writeFileSync(path.join(ordner, `${nr}.jpg`), checkerboard());
      assert.ok(await req('src/images/thumbs.js').previewFrom(`/images/sets/${nr}.jpg`), 'Vorschau');
      await catalogSet(db, nr, { name: 'Durchsichtig', year: 2020, theme: 'Bildprobe', pieces: 10 });
      await db.run('UPDATE set_catalog SET image_local = $2 WHERE set_number = set_number_with_version($1)', [
        nr,
        `/images/sets/${nr}.jpg`,
      ]);
      await holdsSet(db, uid, nr, 1, { preis: 5 });
    },
  });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  await a.ruhig();
  await t.test('quantity saved on immediate close', () => closeQuantityOn(t, a));
  await t.test('preview of a transparent PNG stays transparent', () => transparentPreview(t, a, nr));
});
