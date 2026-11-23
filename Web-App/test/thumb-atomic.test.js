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
const owned = [];
const standard = testAccess();
const connect = standard.ownConnection;
standard.ownConnection = async () => {
  const c = await connect();
  owned.push(c);
  return c;
};
test.after(async () => {
  for (const c of owned) await c.end().catch(() => {});
  await testData()
    .pool?.end?.()
    .catch(() => {});
});

/** Calls `work` and records every rename: source, target, did the target already exist, how big was the source. */
async function withRenameTrack(work) {
  const realFn = fs.promises.rename;
  const spur = [];
  fs.promises.rename = async (from, nach) => {
    spur.push({ von: String(from), nach: String(nach), targetDa: fs.existsSync(nach), size: fs.statSync(from).size });
    return realFn.call(fs.promises, from, nach);
  };
  try {
    return { ergebnis: await work(), spur };
  } finally {
    fs.promises.rename = realFn;
  }
}

function checkAtomic(spur, target) {
  assert.equal(spur.length, 1, `${spur.length} Umbenennungen`);
  const [r] = spur;
  assert.equal(r.nach, target);
  assert.match(r.von, /\.tmp\.jpg$/, 'the temporary name does not end in .tmp.jpg');
  assert.equal(path.dirname(r.von), path.dirname(target), 'temporary in another folder: rename would not be atomic');
  assert.equal(r.targetDa, false, 'the preview was already under its name before the rename');
  assert.equal(r.size, fs.statSync(target).size, 'an unfinished file was renamed');
  assert.deepEqual(
    fs.readdirSync(path.dirname(target)).filter(f => f.endsWith('.tmp.jpg')),
    [],
  );
}

test('vorschauErzeugenAus writes via a temporary file', async () => {
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const dir = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(dir, { recursive: true });
  const name = `zz-atomar-${process.pid}`;
  const original = path.join(dir, `${name}.jpg`),
    preview = path.join(dir, `${name}_thumb.jpg`);
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c00' } })
    .jpeg()
    .toFile(original);
  try {
    const { ergebnis: outcome, spur } = await withRenameTrack(() =>
      _req('src/images/thumbs.js').previewFrom(`/images/sets/${name}.jpg`),
    );
    assert.equal(outcome, `/images/sets/${name}_thumb.jpg`);
    checkAtomic(spur, preview);
  } finally {
    fs.rmSync(original, { force: true });
    fs.rmSync(preview, { force: true });
  }
});

test('createProxyPreview writes via a temporary file', async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxyvorschau-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'a'.repeat(40)),
    target = source + '_thumb.jpg';
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#0a0' } })
    .jpeg()
    .toFile(source + '.jpg');
  fs.renameSync(source + '.jpg', source);
  const { ergebnis: outcome, spur } = await withRenameTrack(() =>
    _req('src/images/proxyThumbs.js').createProxyPreview(source, target),
  );
  assert.equal(outcome, true);
  checkAtomic(spur, target);
  // 400 × 300 fitted, not cropped (UX check 25, B1).
  assert.deepEqual([(await sharp(target).metadata()).width, (await sharp(target).metadata()).height], [200, 150]);
});

test('an unusably small preview is discarded, the original is delivered', async t => {
  const deliverFromCache = (...a) =>
    _req('src/images/http/imageCacheDelivery.js').deliverFromCache(
      require('./helpers/sources').testServices().images,
      ...a,
    );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cachevorschau-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cacheFile = path.join(dir, 'b'.repeat(40)),
    thumbFile = cacheFile + '_thumb.jpg';
  fs.writeFileSync(cacheFile, Buffer.alloc(5000, 1));
  fs.writeFileSync(thumbFile, Buffer.alloc(150, 2));
  const head = {};
  const res = {
    setHeader: (k, v) => {
      head[k.toLowerCase()] = v;
    },
    status: () => ({ end() {} }),
  };
  const delivered = [];
  let noted = 0;
  const answered = await deliverFromCache({
    res,
    req: { fresh: false },
    cacheFile,
    thumbFile,
    wantThumb: true,
    createMay: false,
    note: () => {
      noted++;
    },
    streamFileToResponse: (_r, file) => delivered.push(file),
  });
  assert.equal(answered, true);
  assert.deepEqual(delivered, [cacheFile], 'the original was not served');
  assert.equal(head['content-length'], '5000');
  assert.equal(fs.existsSync(thumbFile), false, 'the broken preview is still there');
  assert.equal(noted, 1, 'the new preview is not queued');
});
