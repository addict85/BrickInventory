/**
 * Order under data/ — images separated by kind, instructions without "shared".
 *
 * Counter-check (measured on 25.10.): always PART_IMAGES_DIR in downloadImage()
 * → red: “minifigure image not in the minifigure folder".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// The helper instead of a naive /\*…\*\/: `'/images/*pfad'` in server.ts
// otherwise opened a comment for it up to the next comment end.
const strip = s =>
  require('./helpers/sources')
    .ohneKommentare(s)
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** All source files that could write paths. */
const SOURCES = [
  'server.ts',
  'routes/api/parts.ts',
  'routes/api/sets.ts',
  'routes/api/setsInstructions.ts',
  'src/sets/service.ts',
  'src/sets/instructions.ts',
  'src/images/thumbs.ts',
  'routes/api/pdf.ts',
  'src/catalog/partsEnrichment.ts',
  'src/catalog/catalogSync.ts',
];

test('no source writes the old paths any more', () => {
  for (const f of SOURCES) {
    const src = strip(read(f));
    // In server.ts the old paths are still allowed as redirects — there
    // they stand in app.get(...) and in cdnForMissingImage, not as the
    // target of a write.
    const writes = [...src.matchAll(/=\s*[`'"]\/data\/(part_images|instructions\/shared)\//g)];
    assert.deepEqual(
      writes.map(m => m[0]),
      [],
      `${f}: still writes an old path`,
    );
  }
});

test('part and figure images land in separate folders', async t => {
  // On behavior: downloadImage() with a rebuilt https.get (without network).
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const { downloadImage } = _req('src/catalog/partsEnrichment.js');
  const { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR } = _req('src/infra/appPaths.js');
  const https = require('node:https');
  const { Readable } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const echt = https.get;
  /** @type {any} */ (https).get = (_a, _o, cb) => {
    const req = Object.assign(new EventEmitter(), { setTimeout: () => req, destroy: () => {} });
    setImmediate(() =>
      cb(
        Object.assign(Readable.from([Buffer.from('PNG')]), {
          statusCode: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    return req;
  };
  const NUM = `ordnertest${process.pid}`;
  t.after(() => {
    https.get = echt;
    for (const d of [PART_IMAGES_DIR, MINIFIG_IMAGES_DIR]) fs.rmSync(path.join(d, `${NUM}_0.png`), { force: true });
  });
  const cdn = 'https://cdn.rebrickable.com/media/x.png';
  assert.equal(
    await downloadImage(cdn, NUM, 0, 'minifig'),
    `/images/minifigs/${NUM}_0.png`,
    'Web path does not follow the kind',
  );
  assert.ok(fs.existsSync(path.join(MINIFIG_IMAGES_DIR, `${NUM}_0.png`)), 'Minifig image not in the minifig folder');
  assert.equal(await downloadImage(cdn, NUM, 0, 'part'), `/images/parts/${NUM}_0.png`);
  assert.ok(fs.existsSync(path.join(PART_IMAGES_DIR, `${NUM}_0.png`)), 'Part image not in the parts folder');
  // The only call for minifigures sits in the image background run.
  assert.match(
    read('src/catalog/imageFollowUp.ts'),
    /downloadImage\(kx, f\.image_url, f\.fig_number, 0, 'minifig'\)/,
    'The minifig download must pass the kind — otherwise minifigs end up with the parts again',
  );
});

test('the image route keeps mandatory login and CDN healing', () => {
  // ONE route for the whole tree under data/images/ so that no part is delivered
  // without login (no static mount: test/media-auth.test.js).
  // strip() before cutting, otherwise an explanatory text pushes the line out.
  assert.match(
    strip(read('routes/pages.ts')),
    /router\.get\('\/images\/\*pfad',[^)]*\)\s*=>\s*deliverImage\(d, req, res\)\)/,
    'Image route not found',
  );
  const src = strip(read('src/images/http/imageDelivery.ts'));
  const start = src.indexOf('function deliverImage(');
  assert.ok(start > 0, 'Image route not found');
  const route = src.slice(start, start + 2000);
  assert.match(route, /userIdTheRequest\(d\.account, req\)/, 'Without the sign-in check the images would be public');
  assert.match(route, /cdnForMissingImage/, 'If the local file is missing, it must still redirect to the image proxy');
});

test('there is no backward compatibility for the old paths any more', () => {
  // deliberate decision
  const src = read('server.ts');
  assert.doesNotMatch(
    src,
    /app\.get\([^)]*['"`]\/data\/part_images/,
    'Weiterleitung für den alten Bildpfad ist wieder da',
  );
  assert.doesNotMatch(src, /app\.get\([^)]*instructions\/shared/, 'The redirect for the old instruction path is back');

  const paths = read('src/infra/appPaths.ts');
  assert.doesNotMatch(
    paths,
    /LEGACY_PART_IMAGES|LEGACY_SHARED_INSTR/,
    'resolveWebPath must no longer know old prefixes',
  );
});

test('daten-rechte creates the new directories', () => {
  // Comments out: the explanatory text in the entrypoint names the old directories
  // ("instructions/shared und part_images sind entfallen") and would have triggered the
  // negative check below itself.
  const ep = read('data-permissions.sh').replace(/^\s*#[^\n]*$/gm, '');
  for (const d of ['images/sets', 'images/parts', 'images/minifigs', 'instructions']) {
    assert.match(ep, new RegExp(`/app/data/${d.replace('/', '\\/')}`), `${d} is missing`);
  }
  assert.doesNotMatch(ep, /instructions\/shared|part_images/, 'The old directories must not be created again');
});
