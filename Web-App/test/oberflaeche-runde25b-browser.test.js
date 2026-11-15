/**
 * Nachtrag zur UX-Prüfung 25 im echten Chrome: Eine Mengenänderung im Set-Detail überlebt das sofortige
 * Schliessen, und die Vorschau eines durchsichtigen PNG bleibt durchsichtig (Dunkelmodus).
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, Bündel bzw. dist neu gebaut):
 *   A  die ausstehende Speicherung wieder mit `if (!offenesSet) return` (Stand vor dem Nachtrag) → rot: „Menge
 *      beim sofortigen Schliessen gespeichert“ (mQtyInc verloren). Ohne den Beobachter allein bleibt es grün:
 *      Die Speicherung kommt dann 400 ms später, er macht sie nur sofort.
 *   B  liefereBild() ohne den Typ aus vorschauTyp() → rot: „Vorschau eines durchsichtigen PNG …“ (image/jpeg)
 *   C  verkleinern() ohne die Prüfung isOpaque → rot: ebenda (innen deckend, 255)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { starteApp } = require('./helpers/app-browser');
const { musterSammlung, katalogSet, haeltSet, mengeVon } = require('./helpers/bestand');

const ROOT = path.join(__dirname, '..');
const SCHLIESSEN = `document.querySelectorAll('.ovl.open [data-dialog-zu]').forEach(x => x.click()); true`;

/** 32 × 32 PNG: roter Rand, innen Schachbrett aus Rot und ganz durchsichtig. */
function schachbrett() {
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
  await a.b.auswerten(SCHLIESSEN);
  await a.b.auswerten(`location.hash = ${JSON.stringify(hash)}; true`);
  await a.bis(bereit, was, 200);
  await a.ruhig(5000);
}

async function mengeBeimSchliessen(_t, a) {
  const { b, bis } = a;
  for (const [knopf, soll] of [
    ['mQtyInc', 2],
    ['mQtyDec', 1],
  ]) {
    await geh(a, '#/sammlung', `!!document.querySelector('#gallery .sc[data-arg="10300-1"]')`, 'Sammlung');
    await b.auswerten(`document.querySelector('#gallery .sc[data-arg="10300-1"]').click(); true`);
    await bis(`document.getElementById('m-qty')?.value === '${3 - Number(soll)}'`, 'Detail');
    // Ändern und im selben Zug schliessen: weit unter den 400 ms bis zum Speichern.
    await b.auswerten(`document.querySelector('#set-modal [data-click="${knopf}"]').click();
      document.querySelector('#set-modal [data-dialog-zu]').click(); true`);
    await bis(`!document.getElementById('set-modal').classList.contains('open')`, 'geschlossen');
    await a.warte(800);
    await a.ruhig();
    assert.equal(await mengeVon(a.db, [a.uid], '10300-1'), soll, `${knopf} und sofort geschlossen: verloren`);
  }
}

async function durchsichtigeVorschau(_t, a, nr) {
  const { b, bis } = a;
  await b.auswerten(`document.documentElement.setAttribute('data-dunkel', ''); true`);
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
    await b.auswerten(`document.documentElement.removeAttribute('data-dunkel'); true`);
  }
}

test('UX-Prüfung 25, Nachtrag im Browser', { concurrency: 1, timeout: 600_000 }, async t => {
  const nr = `r25b-${process.pid}-1`;
  const req = require('./helpers/sources').buildAndRequire();
  const ordner = path.join(ROOT, 'data', 'images', 'sets');
  t.after(() => {
    for (const d of [`${nr}.jpg`, `${nr}_thumb.jpg`]) fs.rmSync(path.join(ordner, d), { force: true });
  });
  const a = await starteApp(t, {
    name: `r25b_${process.pid}`,
    bestand: async (db, uid) => {
      await musterSammlung(db, uid);
      // Wie die App Set-Bilder ablegt: <nr>.jpg, daneben die Vorschau aus vorschauErzeugenAus.
      fs.mkdirSync(ordner, { recursive: true });
      fs.writeFileSync(path.join(ordner, `${nr}.jpg`), schachbrett());
      assert.ok(await req('src/bilder/thumbs.js').vorschauErzeugenAus(`/images/sets/${nr}.jpg`), 'Vorschau');
      await katalogSet(db, nr, { name: 'Durchsichtig', year: 2020, theme: 'Bildprobe', pieces: 10 });
      await db.run('UPDATE set_catalog SET image_local = $2 WHERE set_number = set_nummer_mit_version($1)', [
        nr,
        `/images/sets/${nr}.jpg`,
      ]);
      await haeltSet(db, uid, nr, 1, { preis: 5 });
    },
  });
  if (a.grund) {
    t.skip(a.grund);
    return;
  }
  await a.ruhig();
  await t.test('Menge beim sofortigen Schliessen gespeichert', () => mengeBeimSchliessen(t, a));
  await t.test('Vorschau eines durchsichtigen PNG bleibt durchsichtig', () => durchsichtigeVorschau(t, a, nr));
});
