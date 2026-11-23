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
  const block = (kind, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const content = Buffer.concat([Buffer.from(kind), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(zlib.crc32(content));
    return Buffer.concat([len, content, checksum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const rand = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      raw.set(rand || (x + y) % 2 === 0 ? [200, 40, 40, 255] : [0, 0, 0, 0], y * (w * 4 + 1) + 1 + x * 4);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    block('IHDR', head),
    block('IDAT', zlib.deflateSync(raw)),
    block('IEND', Buffer.alloc(0)),
  ]);
}

async function geh(a, hash, ready, was) {
  await a.b.evaluate(CLOSE);
  await a.b.evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await a.until(ready, was, 200);
  await a.settle(5000);
}

async function closeQuantityOn(_t, a) {
  const { b, until } = a;
  for (const [button, want] of [
    ['mQtyInc', 2],
    ['mQtyDec', 1],
  ]) {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
    await b.evaluate(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
    await until(`document.getElementById('m-qty')?.value === '${3 - Number(want)}'`, 'Detail');
    // Change and close in the same move: far below the 400 ms until saving.
    await b.evaluate(`document.querySelector('#set-modal [data-click="${button}"]').click();
      document.querySelector('#set-modal [data-dialog-close]').click(); true`);
    await until(`!document.getElementById('set-modal').classList.contains('open')`, 'geschlossen');
    await a.sleep(800);
    await a.settle();
    assert.equal(await quantityOf(a.db, [a.uid], '10300-1'), want, `${button} and closed immediately: lost`);
  }
}

async function transparentPreview(_t, a, nr) {
  const { b, until } = a;
  await b.evaluate(`document.documentElement.setAttribute('data-dark', ''); true`);
  try {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="${nr}"] .sci img')`, 'Sammlung');
    await until(
      `(i => i.complete && i.naturalWidth > 0)(document.querySelector('#gallery .sc[data-arg="${nr}"] .sci img'))`,
      'Kachelbild',
    );
    const m =
      await b.evaluate(`(async () => { const i = document.querySelector('#gallery .sc[data-arg="${nr}"] .sci img');
      const r = await fetch(i.currentSrc); const bild = await createImageBitmap(await r.blob());
      const c = document.createElement('canvas'); c.width = bild.width; c.height = bild.height;
      const g = c.getContext('2d'); g.drawImage(bild, 0, 0);
      return { source: i.currentSrc.replace(/^.*\\/images\\//, ''), kind: r.headers.get('content-type'),
        rand: g.getImageData(0, 0, 1, 1).data[3], inner: g.getImageData(3, 2, 1, 1).data[3] }; })()`);
    assert.match(m.source, /_thumb\.jpg$/, `test data: tile shows the preview: ${JSON.stringify(m)}`);
    assert.equal(m.kind, 'image/png', `preview with wrong type: ${JSON.stringify(m)}`);
    assert.deepEqual([m.rand, m.inner], [255, 0], `transparency was lost: ${JSON.stringify(m)}`);
  } finally {
    await b.evaluate(`document.documentElement.removeAttribute('data-dark'); true`);
  }
}

test('quantity on close, PNG preview', { concurrency: 1, timeout: 600_000 }, async t => {
  const nr = `r25b-${process.pid}-1`;
  const req = require('./helpers/sources').buildAndRequire();
  const dir = path.join(ROOT, 'data', 'images', 'sets');
  t.after(() => {
    for (const d of [`${nr}.jpg`, `${nr}_thumb.jpg`]) fs.rmSync(path.join(dir, d), { force: true });
  });
  const a = await startApp(t, {
    name: `r25b_${process.pid}`,
    holding: async (db, uid) => {
      await patternCollection(db, uid);
      // How the app stores set images: <nr>.jpg, next to it the preview from vorschauErzeugenAus.
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${nr}.jpg`), checkerboard());
      assert.ok(await req('src/images/thumbs.js').previewFrom(`/images/sets/${nr}.jpg`), 'preview');
      await catalogSet(db, nr, { name: 'Durchsichtig', year: 2020, theme: 'Bildprobe', pieces: 10 });
      await db.run('UPDATE set_catalog SET image_local = $2 WHERE set_number = set_number_with_version($1)', [
        nr,
        `/images/sets/${nr}.jpg`,
      ]);
      await holdsSet(db, uid, nr, 1, { price: 5 });
    },
  });
  if (a.reason) {
    t.skip(a.reason);
    return;
  }
  await a.settle();
  await t.test('quantity saved on immediate close', () => closeQuantityOn(t, a));
  await t.test('preview of a transparent PNG stays transparent', () => transparentPreview(t, a, nr));
});
