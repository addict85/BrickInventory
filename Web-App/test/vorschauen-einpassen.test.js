/**
 * Vorschauen aus der Zeit des quadratischen Zuschnitts (200 × 200 zu nicht quadratischem Original) werden
 * einmal neu eingepasst: eigene Bilder neu erzeugt, im Proxy-Cache gelöscht. Ein Merker in run_state hält
 * es bei einem Lauf; richtige Vorschauen und quadratische Bilder bleiben unberührt.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln, dist neu gebaut), in src/images/fitPreviews.ts:
 *   A  die Abfrage des Merkers entfernt → rot: „läuft nur einmal“ (die neue alte Vorschau wird ersetzt)
 *   B  zugeschnitten() prüft das Original nicht mehr (jede 200 × 200) → rot: „ersetzt nur zugeschnittene“
 *      (die Vorschau des quadratischen Bilds wird neu geschrieben)
 *   C  der Proxy-Teil entfernt → rot: ebenda (Proxy-Vorschau bleibt)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const sharp = require('sharp');
const { DATA_DIR } = _req('src/infra/appPaths.js');
const { fitTailoredPreviews, FITTED_MARKER } = _req('src/images/fitPreviews.js');

const jpeg = (datei, width, height) =>
  sharp({ create: { width, height, channels: 3, background: '#2a6' } })
    .jpeg()
    .toFile(datei);
const masse = async datei => {
  const m = await sharp(datei).metadata();
  return [m.width, m.height];
};

test('zugeschnittene Vorschauen werden einmal neu eingepasst', async t => {
  const sets = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(sets, { recursive: true });
  const proxy = fs.mkdtempSync(path.join(os.tmpdir(), 'einpassen-proxy-'));
  const quer = `zz-einpassen-quer-${process.pid}`,
    quadrat = `zz-einpassen-quadrat-${process.pid}`;
  const datei = n => path.join(sets, `${n}.jpg`),
    vorschau = n => path.join(sets, `${n}_thumb.jpg`);
  t.after(() => {
    for (const n of [quer, quadrat]) for (const d of [datei(n), vorschau(n)]) fs.rmSync(d, { force: true });
    fs.rmSync(proxy, { recursive: true, force: true });
  });
  await jpeg(datei(quer), 400, 200);
  await jpeg(vorschau(quer), 200, 200);
  await jpeg(datei(quadrat), 300, 300);
  await jpeg(vorschau(quadrat), 200, 200);
  const quadratBefore = fs.statSync(vorschau(quadrat)).mtimeMs;
  await jpeg(path.join(proxy, 'a'.repeat(40)), 400, 300);
  await jpeg(path.join(proxy, `${'a'.repeat(40)}_thumb.jpg`), 200, 200);
  await jpeg(path.join(proxy, 'b'.repeat(40)), 400, 300);
  await jpeg(path.join(proxy, `${'b'.repeat(40)}_thumb.jpg`), 200, 150);

  const zustand = new Map();
  const k = {
    jobQueue: {
      liesZustand: async s => zustand.get(s) ?? null,
      setzeZustand: async (s, w) => {
        zustand.set(s, String(w));
      },
    },
    uhr: _req('src/infra/clock.js').systemClock,
  };
  const lokale = [quer, quadrat].map(n => ({ web: `/images/sets/${n}.jpg`, datei: datei(n) }));

  await t.test('ersetzt nur zugeschnittene', async () => {
    assert.equal(await fitTailoredPreviews(k, lokale, proxy), 2);
    assert.deepEqual(await masse(vorschau(quer)), [200, 100], 'eigene Vorschau neu eingepasst');
    assert.equal(fs.statSync(vorschau(quadrat)).mtimeMs, quadratBefore, 'quadratisches Bild blieb nicht unberührt');
    assert.equal(fs.existsSync(path.join(proxy, `${'a'.repeat(40)}_thumb.jpg`)), false, 'Proxy-Vorschau bleibt');
    assert.ok(fs.existsSync(path.join(proxy, `${'b'.repeat(40)}_thumb.jpg`)), 'richtige Proxy-Vorschau gelöscht');
    assert.ok(zustand.get(FITTED_MARKER), 'Merker fehlt');
  });

  await t.test('läuft nur einmal', async () => {
    await jpeg(vorschau(quer), 200, 200);
    assert.equal(await fitTailoredPreviews(k, lokale, proxy), null);
    assert.deepEqual(await masse(vorschau(quer)), [200, 200]);
  });
});
