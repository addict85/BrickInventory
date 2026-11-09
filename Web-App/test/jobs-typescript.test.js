/**
 * jobs/ nach TypeScript (Punkt 10).
 * Ausführlich: docs/begruendungen/test/jobs-typescript.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JOBS = path.join(ROOT, 'jobs');

test('alle Jobs sind TypeScript', () => {
  const ts = fs.readdirSync(JOBS).filter(f => f.endsWith('.ts'));
  const jsOnly = fs.readdirSync(JOBS)
    .filter(f => f.endsWith('.js'))
    .filter(f => !fs.existsSync(path.join(JOBS, f.replace(/\.js$/, '.ts'))));
  assert.equal(jsOnly.length, 0, `Nicht migriert: ${jsOnly.join(', ')}`);
  assert.ok(ts.length >= 3, `Nur ${ts.length} .ts-Dateien gefunden`);
});

test('das Build-Skript erfasst jobs/', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  assert.match(build, /SRC_DIRS = \[[^\]]*'jobs'/,
    "Ohne 'jobs' in SRC_DIRS entstehen keine .js-Dateien und die require-Aufrufe schlagen fehl");
});

test('der Dockerfile baut jobs/ statt es roh zu kopieren', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  // Seit der Build nach dist/ schreibt, kommt der gesamte transpilierte Baum
  // (server.js, db/, routes/, utils/, jobs/) mit EINEM COPY. Die Absicht dieses
  // Tests ist unverändert: Der Runtime-Stage darf keine .ts-Quelle sehen.
  assert.match(df, /--outdir dist/,
    'Der Build muss nach dist/ schreiben, sonst liegen Quelle und Erzeugnis wieder nebeneinander');
  assert.match(df, /COPY --from=builder \/app\/dist \.\/dist\//,
    'dist/ muss transpiliert aus dem Build-Stage kommen, sonst landen .ts-Dateien im Image');

  const runtime = df.slice(df.lastIndexOf('FROM '));
  for (const dir of ['jobs', 'db', 'routes', 'src']) {
    assert.doesNotMatch(runtime, new RegExp(`^COPY ${dir}/`, 'm'),
      `Der Runtime-Stage darf ${dir}/ nicht roh kopieren — dort lägen sonst .ts-Dateien`);
  }
  assert.doesNotMatch(runtime, /^COPY server\.ts/m,
    'server.ts gehört nicht ins Laufzeit-Image');
});

test('benannte Exporte statt module.exports', () => {
  // In .ts erzeugt module.exports keine benannten Exporte — Aufrufer wie
  // routes/sets.ts importieren aber per Namen (`import { refreshPriceForSet }`).
  // csvImportWorker ist der Einstiegspunkt eines eigenen Prozesses
  // (process.on('message')) und exportiert bewusst nichts.
  const ENTRYPOINTS = new Set(['csvImportWorker.ts']);
  for (const f of fs.readdirSync(JOBS).filter(f => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(JOBS, f), 'utf8');
    assert.doesNotMatch(src, /^module\.exports = /m, `${f}: noch module.exports`);
    if (!ENTRYPOINTS.has(f)) assert.match(src, /^export \{/m, `${f}: kein benannter Export`);
  }
});

test('jedes Job-Modul lässt sich laden', () => {
  // Fängt Tippfehler in Exportnamen und zirkuläre Importe ab, die der
  // Typecheck nicht sieht.
  // Ausführlich: docs/begruendungen/test/jobs-typescript.test.js.md#dist-jobs
  const DIST_JOBS = path.join(ROOT, 'dist', 'jobs');
  assert.ok(fs.existsSync(DIST_JOBS),
    'dist/jobs fehlt — bitte zuerst `npm run build` ausführen (in CI ist das ein eigener Schritt)');

  const built = fs.readdirSync(DIST_JOBS).filter(f => f.endsWith('.js'));
  const sources = fs.readdirSync(JOBS).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  assert.equal(built.length, sources.length,
    `dist/jobs hat ${built.length} Dateien, jobs/ ${sources.length} Quellen — Build veraltet?`);

  for (const f of built) {
    const m = require(path.join(DIST_JOBS, f));
    assert.equal(typeof m, 'object', `${f} exportiert kein Objekt`);
  }
});
