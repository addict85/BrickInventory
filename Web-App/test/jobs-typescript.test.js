/**
 * jobs/ to TypeScript (item 10).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JOBS = path.join(ROOT, 'jobs');

test('all jobs are TypeScript', () => {
  const ts = fs.readdirSync(JOBS).filter(f => f.endsWith('.ts'));
  const jsOnly = fs
    .readdirSync(JOBS)
    .filter(f => f.endsWith('.js'))
    .filter(f => !fs.existsSync(path.join(JOBS, f.replace(/\.js$/, '.ts'))));
  assert.equal(jsOnly.length, 0, `Nicht migriert: ${jsOnly.join(', ')}`);
  assert.ok(ts.length >= 3, `Nur ${ts.length} .ts-Dateien gefunden`);
});

test('the build script covers jobs/', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  assert.match(
    build,
    /SRC_DIRS = \[[^\]]*'jobs'/,
    "Ohne 'jobs' in SRC_DIRS entstehen keine .js-Dateien und die require-Aufrufe schlagen fehl",
  );
});

test('the Dockerfile builds jobs/ instead of copying it raw', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  // Since the build writes to dist/, the whole transpiled tree
  // (server.js, db/, routes/, utils/, jobs/) comes with ONE COPY. The intent of this
  // test is unchanged: the runtime stage must see no .ts source.
  assert.match(
    df,
    /--outdir dist/,
    'Der Build muss nach dist/ schreiben, sonst liegen Quelle und Erzeugnis wieder nebeneinander',
  );
  assert.match(
    df,
    /COPY --from=builder \/app\/dist \.\/dist\//,
    'dist/ muss transpiliert aus dem Build-Stage kommen, sonst landen .ts-Dateien im Image',
  );

  const runtime = df.slice(df.lastIndexOf('FROM '));
  for (const dir of ['jobs', 'db', 'routes', 'src']) {
    assert.doesNotMatch(
      runtime,
      new RegExp(`^COPY ${dir}/`, 'm'),
      `Der Runtime-Stage darf ${dir}/ nicht roh kopieren — dort lägen sonst .ts-Dateien`,
    );
  }
  assert.doesNotMatch(runtime, /^COPY server\.ts/m, 'server.ts gehört nicht ins Laufzeit-Image');
});

test('named exports instead of module.exports', () => {
  // In .ts module.exports creates no named exports — but callers like
  // src/sets/afterAdd.ts import by name (`import { fetchPriceForSet }`).
  // csvImportWorker is the entry point of its own process
  // (process.on('message')) and deliberately exports nothing.
  const ENTRYPOINTS = new Set(['csvImportWorker.ts']);
  for (const f of fs.readdirSync(JOBS).filter(f => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(JOBS, f), 'utf8');
    assert.doesNotMatch(src, /^module\.exports = /m, `${f}: noch module.exports`);
    if (!ENTRYPOINTS.has(f)) assert.match(src, /^export \{/m, `${f}: kein benannter Export`);
  }
});

test('every job module can be loaded', () => {
  // Catches typos in export names and circular imports that the
  // type check does not see.
  const DIST_JOBS = path.join(ROOT, 'dist', 'jobs');
  assert.ok(
    fs.existsSync(DIST_JOBS),
    'dist/jobs fehlt — bitte zuerst `npm run build` ausführen (in CI ist das ein eigener Schritt)',
  );

  const built = fs.readdirSync(DIST_JOBS).filter(f => f.endsWith('.js'));
  const sources = fs.readdirSync(JOBS).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  assert.equal(
    built.length,
    sources.length,
    `dist/jobs hat ${built.length} Dateien, jobs/ ${sources.length} Quellen — Build veraltet?`,
  );

  for (const f of built) {
    const m = require(path.join(DIST_JOBS, f));
    assert.equal(typeof m, 'object', `${f} exportiert kein Objekt`);
  }
});
