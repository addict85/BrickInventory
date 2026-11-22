/**
 * Previews arise ATOMICALLY: both producers (vorschauErzeugenAus for own
 * images, createProxyPreview for the image proxy) write to a temporary
 * name and only rename the finished file. An unusably small
 * preview in the cache is discarded, the original is delivered.
 *
 * Counter-checks (measured 10.11.2026, each on its own, dist rebuilt):
 *   A  in thumbs.ts written directly to thumbFs (rename removed) → red:
 *      “vorschauErzeugenAus writes …”
 *   B  the same in proxyThumbs.ts → red: “createProxyPreview writes …”
 *   C  in imgCacheServe.ts `tst.size < 200` → `< 20` → red: “an
 *      unusably small preview …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const sharp = require('sharp');

// The preview lock holds its own connection open; recorded so that the test can close it.
const eigene = [];
const standard = testAccess();
const connect = standard.ownConnection;
standard.ownConnection = async () => {
  const c = await connect();
  eigene.push(c);
  return c;
};
test.after(async () => {
  for (const c of eigene) await c.end().catch(() => {});
  await testData()
    .pool?.end?.()
    .catch(() => {});
});

/** Calls `work` and records every rename: source, target, did the target already exist, how big was the source. */
async function withRenameTrack(work) {
  const echt = fs.promises.rename;
  const spur = [];
  fs.promises.rename = async (von, nach) => {
    spur.push({ von: String(von), nach: String(nach), targetDa: fs.existsSync(nach), groesse: fs.statSync(von).size });
    return echt.call(fs.promises, von, nach);
  };
  try {
    return { ergebnis: await work(), spur };
  } finally {
    fs.promises.rename = echt;
  }
}

function checkAtomic(spur, ziel) {
  assert.equal(spur.length, 1, `${spur.length} Umbenennungen`);
  const [r] = spur;
  assert.equal(r.nach, ziel);
  assert.match(r.von, /\.tmp\.jpg$/, 'der temporäre Name endet nicht auf .tmp.jpg');
  assert.equal(path.dirname(r.von), path.dirname(ziel), 'temporär in einem anderen Ordner: rename wäre nicht atomar');
  assert.equal(r.targetDa, false, 'die Vorschau lag schon vor dem Umbenennen unter ihrem Namen');
  assert.equal(r.groesse, fs.statSync(ziel).size, 'umbenannt wurde eine unfertige Datei');
  assert.deepEqual(
    fs.readdirSync(path.dirname(ziel)).filter(f => f.endsWith('.tmp.jpg')),
    [],
  );
}

test('vorschauErzeugenAus writes via a temporary file', async () => {
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const ordner = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });
  const name = `zz-atomar-${process.pid}`;
  const original = path.join(ordner, `${name}.jpg`),
    preview = path.join(ordner, `${name}_thumb.jpg`);
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c00' } })
    .jpeg()
    .toFile(original);
  try {
    const { ergebnis, spur } = await withRenameTrack(() =>
      _req('src/images/thumbs.js').previewFrom(`/images/sets/${name}.jpg`),
    );
    assert.equal(ergebnis, `/images/sets/${name}_thumb.jpg`);
    checkAtomic(spur, preview);
  } finally {
    fs.rmSync(original, { force: true });
    fs.rmSync(preview, { force: true });
  }
});

test('createProxyPreview writes via a temporary file', async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'proxyvorschau-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const source = path.join(ordner, 'a'.repeat(40)),
    ziel = source + '_thumb.jpg';
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#0a0' } })
    .jpeg()
    .toFile(source + '.jpg');
  fs.renameSync(source + '.jpg', source);
  const { ergebnis, spur } = await withRenameTrack(() =>
    _req('src/images/proxyThumbs.js').createProxyPreview(source, ziel),
  );
  assert.equal(ergebnis, true);
  checkAtomic(spur, ziel);
  // 400 × 300 fitted, not cropped (UX check 25, B1).
  assert.deepEqual([(await sharp(ziel).metadata()).width, (await sharp(ziel).metadata()).height], [200, 150]);
});

test('an unusably small preview is discarded, the original is delivered', async t => {
  const deliverFromCache = (...a) =>
    _req('src/images/http/imageCacheDelivery.js').deliverFromCache(
      require('./helpers/sources').testServices().images,
      ...a,
    );
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'cachevorschau-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const cacheFile = path.join(ordner, 'b'.repeat(40)),
    thumbFile = cacheFile + '_thumb.jpg';
  fs.writeFileSync(cacheFile, Buffer.alloc(5000, 1));
  fs.writeFileSync(thumbFile, Buffer.alloc(150, 2));
  const kopf = {};
  const res = {
    setHeader: (k, v) => {
      kopf[k.toLowerCase()] = v;
    },
    status: () => ({ end() {} }),
  };
  const geliefert = [];
  let noted = 0;
  const beantwortet = await deliverFromCache({
    res,
    req: { fresh: false },
    cacheFile,
    thumbFile,
    wantThumb: true,
    createMay: false,
    note: () => {
      noted++;
    },
    streamFileToResponse: (_r, datei) => geliefert.push(datei),
  });
  assert.equal(beantwortet, true);
  assert.deepEqual(geliefert, [cacheFile], 'nicht das Original ausgeliefert');
  assert.equal(kopf['content-length'], '5000');
  assert.equal(fs.existsSync(thumbFile), false, 'die kaputte Vorschau liegt noch da');
  assert.equal(noted, 1, 'die neue Vorschau ist nicht vorgemerkt');
});
