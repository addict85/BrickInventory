/**
 * Previews from the time of the square crop (200 × 200 for a non-square original) are
 * refitted once: own images regenerated, deleted in the proxy cache. A marker in run_state keeps
 * it at one run; correct previews and square images stay untouched.
 *
 * Counter-checks (measured 14.11.2026, each on its own, dist rebuilt), in src/images/fitPreviews.ts:
 *   A  the query of the marker removed → red: “runs only once” (the new old preview is replaced)
 *   B  zugeschnitten() no longer checks the original (every 200 × 200) → red: “replaces only cropped ones”
 *      (the preview of the square image is rewritten)
 *   C  the proxy part removed → red: same place (proxy preview stays)
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

test('cropped previews are refitted once', async t => {
  const sets = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(sets, { recursive: true });
  const proxy = fs.mkdtempSync(path.join(os.tmpdir(), 'einpassen-proxy-'));
  const quer = `zz-einpassen-quer-${process.pid}`,
    quadrat = `zz-einpassen-quadrat-${process.pid}`;
  const datei = n => path.join(sets, `${n}.jpg`),
    preview = n => path.join(sets, `${n}_thumb.jpg`);
  t.after(() => {
    for (const n of [quer, quadrat]) for (const d of [datei(n), preview(n)]) fs.rmSync(d, { force: true });
    fs.rmSync(proxy, { recursive: true, force: true });
  });
  await jpeg(datei(quer), 400, 200);
  await jpeg(preview(quer), 200, 200);
  await jpeg(datei(quadrat), 300, 300);
  await jpeg(preview(quadrat), 200, 200);
  const quadratBefore = fs.statSync(preview(quadrat)).mtimeMs;
  await jpeg(path.join(proxy, 'a'.repeat(40)), 400, 300);
  await jpeg(path.join(proxy, `${'a'.repeat(40)}_thumb.jpg`), 200, 200);
  await jpeg(path.join(proxy, 'b'.repeat(40)), 400, 300);
  await jpeg(path.join(proxy, `${'b'.repeat(40)}_thumb.jpg`), 200, 150);

  const condition = new Map();
  const k = {
    jobQueue: {
      readState: async s => condition.get(s) ?? null,
      setState: async (s, w) => {
        condition.set(s, String(w));
      },
    },
    clock: _req('src/infra/clock.js').systemClock,
  };
  const lokale = [quer, quadrat].map(n => ({ web: `/images/sets/${n}.jpg`, datei: datei(n) }));

  await t.test('replaces only cropped ones', async () => {
    assert.equal(await fitTailoredPreviews(k, lokale, proxy), 2);
    assert.deepEqual(await masse(preview(quer)), [200, 100], 'own preview refitted');
    assert.equal(fs.statSync(preview(quadrat)).mtimeMs, quadratBefore, 'square image was not left untouched');
    assert.equal(fs.existsSync(path.join(proxy, `${'a'.repeat(40)}_thumb.jpg`)), false, 'proxy preview stays');
    assert.ok(fs.existsSync(path.join(proxy, `${'b'.repeat(40)}_thumb.jpg`)), 'correct proxy preview deleted');
    assert.ok(condition.get(FITTED_MARKER), 'marker is missing');
  });

  await t.test('runs only once', async () => {
    await jpeg(preview(quer), 200, 200);
    assert.equal(await fitTailoredPreviews(k, lokale, proxy), null);
    assert.deepEqual(await masse(preview(quer)), [200, 200]);
  });
});
