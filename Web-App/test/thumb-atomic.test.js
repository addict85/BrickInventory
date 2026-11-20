/**
 * Vorschaubilder entstehen ATOMAR: Beide Erzeuger (vorschauErzeugenAus für eigene
 * Bilder, createProxyPreview für den Bild-Proxy) schreiben auf einen temporären
 * Namen und benennen erst die fertige Datei um. Eine unbrauchbar kleine
 * Vorschau im Cache wird verworfen, ausgeliefert wird das Original.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, dist neu gebaut):
 *   A  in thumbs.ts direkt auf thumbFs geschrieben (rename entfernt) → rot:
 *      „vorschauErzeugenAus schreibt …“
 *   B  dasselbe in proxyThumbs.ts → rot: „createProxyPreview schreibt …“
 *   C  in imgCacheServe.ts `tst.size < 200` → `< 20` → rot: „eine
 *      unbrauchbar kleine Vorschau …“
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

// Die Vorschau-Sperre hält eine eigene Verbindung offen; mitgeschrieben, damit der Test sie schliessen kann.
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

/** Ruft `work` und schreibt jedes rename mit: Quelle, Ziel, gab es das Ziel schon, wie gross war die Quelle. */
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

test('vorschauErzeugenAus schreibt über eine temporäre Datei', async () => {
  const { DATA_DIR } = _req('src/infra/appPaths.js');
  const ordner = path.join(DATA_DIR, 'images', 'sets');
  fs.mkdirSync(ordner, { recursive: true });
  const name = `zz-atomar-${process.pid}`;
  const original = path.join(ordner, `${name}.jpg`),
    vorschau = path.join(ordner, `${name}_thumb.jpg`);
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c00' } })
    .jpeg()
    .toFile(original);
  try {
    const { ergebnis, spur } = await withRenameTrack(() =>
      _req('src/bilder/thumbs.js').vorschauErzeugenAus(`/images/sets/${name}.jpg`),
    );
    assert.equal(ergebnis, `/images/sets/${name}_thumb.jpg`);
    checkAtomic(spur, vorschau);
  } finally {
    fs.rmSync(original, { force: true });
    fs.rmSync(vorschau, { force: true });
  }
});

test('createProxyPreview schreibt über eine temporäre Datei', async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'proxyvorschau-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const quelle = path.join(ordner, 'a'.repeat(40)),
    ziel = quelle + '_thumb.jpg';
  await sharp({ create: { width: 400, height: 300, channels: 3, background: '#0a0' } })
    .jpeg()
    .toFile(quelle + '.jpg');
  fs.renameSync(quelle + '.jpg', quelle);
  const { ergebnis, spur } = await withRenameTrack(() =>
    _req('src/bilder/proxyThumbs.js').createProxyPreview(quelle, ziel),
  );
  assert.equal(ergebnis, true);
  checkAtomic(spur, ziel);
  // 400 × 300 eingepasst, nicht zugeschnitten (UX-Prüfung 25, B1).
  assert.deepEqual([(await sharp(ziel).metadata()).width, (await sharp(ziel).metadata()).height], [200, 150]);
});

test('eine unbrauchbar kleine Vorschau wird verworfen, ausgeliefert wird das Original', async t => {
  const deliverFromCache = (...a) =>
    _req('src/bilder/http/bildCacheAuslieferung.js').deliverFromCache(
      require('./helpers/sources').testServices().bilder,
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
