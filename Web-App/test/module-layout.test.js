/**
 * Where modules lie — and that an API name is not a path.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');

/** All server sources (without tests, node_modules, dist). */
/**
 * The source folders to check — read FROM THE BUILD SCRIPT, not copied
 * here.
 */
function srcDirs() {
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  const row = build.match(/const SRC_DIRS = \[([^\]]*)\]/);
  assert.ok(row, 'SRC_DIRS im Bauskript nicht gefunden');
  const dirs = [...row[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(dirs.length >= 5, `nur ${dirs.length} Quellordner — das Muster greift nicht mehr`);
  return dirs;
}

function sources() {
  const raus = [];
  for (const dir of srcDirs()) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const stapel = [abs];
    while (stapel.length) {
      const d = stapel.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stapel.push(p);
        else if (e.name.endsWith('.ts')) raus.push(p);
      }
    }
  }
  raus.push(path.join(ROOT, 'server.ts'));
  return raus;
}

test('the API quotas are named after the API, not after a path', () => {
  // The keys stand in rate_limits/global_settings. A path in them
  // means: a second, empty count next to the real one.
  const treffer = [];
  for (const datei of sources()) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const fn of [
      'zaehleKontingent',
      'quotaStatus',
      'quotaLimit',
      'checkAndCountQuota',
      'quotaOverview',
      'limitTheSource',
    ]) {
      const re = new RegExp(`${fn}\\(\\s*'([^']+)'`, 'g');
      for (const m of src.matchAll(re)) {
        if (m[1].includes('/') || m[1].includes('.')) {
          treffer.push(`${path.relative(ROOT, datei)}: ${fn}('${m[1]}')`);
        }
      }
    }
  }
  assert.deepEqual(
    treffer,
    [],
    'Ein Kontingent-Schlüssel enthält einen Pfad. Das ist fast sicher eine ' +
      'verunglückte Ersetzung — die Zählung liefe unter neuem Namen bei null ' +
      'weiter, ohne dass irgendetwas abstürzt:\n  ' +
      treffer.join('\n  '),
  );
});

test('no module is fetched under a bare name', () => {
  // The opposite direction: when reverting the error above I shortened three
  // real require('../clients/rebrickable') to require('rebrickable').
  // Node then searches in node_modules — 500s at runtime.
  const eigene = new Set([
    'rebrickable',
    'brickset',
    'sets',
    'parts',
    'minifigs',
    'finance',
    'settings',
    'auth',
    'handlers',
    'financeCalc',
    'database',
  ]);
  const treffer = [];
  for (const datei of sources()) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/(?:require\(|from )\s*'([^'./][^']*)'/g)) {
      if (eigene.has(m[1])) treffer.push(`${path.relative(ROOT, datei)}: '${m[1]}'`);
    }
  }
  assert.deepEqual(
    treffer,
    [],
    'Ein projekteigenes Modul wird ohne Pfad geholt — Node sucht es dann in ' +
      'node_modules und wirft zur Laufzeit:\n  ' +
      treffer.join('\n  '),
  );
});

test('clients/ contains no routes and is built anyway', () => {
  // The folder exists BECAUSE these two files are not routers. If a route
  // gets into either of them, the file belongs back in routes/.
  for (const f of fs.readdirSync(path.join(ROOT, 'clients'))) {
    if (!f.endsWith('.ts')) continue;
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'clients', f), 'utf8'));
    assert.doesNotMatch(
      src,
      /^\s*router\.(get|post|put|delete|patch|endpoint)\(/m,
      `clients/${f} hat eine Route — dann ist es ein Router und gehört nach routes/`,
    );
  }

  // And the build script must know the folder. If it is missing there, no
  // dist/clients/ arises and EVERY import of it runs into nothing at the start — exactly
  // on that the move almost failed.
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  const row = build.match(/const SRC_DIRS = \[([^\]]*)\]/);
  assert.ok(row, 'SRC_DIRS nicht gefunden');
  assert.match(row[1], /'clients'/, 'Das Bauskript baut clients/ nicht mit');
});

test('no cycles via real import statements', () => {
  // Why this deserves its own check
  const graph = new Map();
  const dateien = sources();
  const kennt = new Set(dateien.map(d => path.resolve(d)));

  const resolveIt = (von, rel) => {
    const basis = path.resolve(path.dirname(von), rel);
    for (const k of [basis + '.ts', path.join(basis, 'index.ts')]) {
      if (kennt.has(k)) return k;
    }
    return null;
  };

  for (const datei of dateien) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    const ziele = new Set();
    // `import type` disappears when compiling and loads nothing at runtime.
    for (const m of src.matchAll(/^import (?!type\b)[^;]*from\s*'(\.[^']+)'/gm)) {
      const z = resolveIt(datei, m[1]);
      if (z && z !== path.resolve(datei)) ziele.add(z);
    }
    graph.set(path.resolve(datei), ziele);
  }

  const found = [];
  const stapel = [];
  const fertig = new Set();
  const lauf = u => {
    stapel.push(u);
    for (const v of graph.get(u) || []) {
      const i = stapel.indexOf(v);
      if (i >= 0) {
        found.push(
          stapel
            .slice(i)
            .concat(v)
            .map(x => path.relative(ROOT, x))
            .join(' → '),
        );
      } else if (!fertig.has(v)) {
        fertig.add(v);
        lauf(v);
      }
    }
    stapel.pop();
  };
  for (const n of graph.keys()) lauf(n);

  assert.deepEqual(
    [...new Set(found)],
    [],
    'Kreis über echte import-Anweisungen — zur Ladezeit ist eine Seite ' +
      'undefined, und das fällt erst im Betrieb auf:\n  ' +
      [...new Set(found)].join('\n  '),
  );
});

// Counter-checks (measured 11.11.2026, each on its own): in the Dockerfile `COPY . .` replaced by
// the earlier list without startup/ → red „Das Bau-Stage kopiert den
// Kontext nicht ganz …“; `startup` added in .dockerignore → red „startup wird
// von .dockerignore ausgeschlossen“; `*.ts` there → red „server.ts wird …“.
test('every source folder also arrives in the container', () => {
  // One list: SRC_DIRS. The Dockerfile copies the whole context, .dockerignore must not hit any source folder.
  const dockerfile = fs
    .readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  const dirs = srcDirs();
  const bau = dockerfile.slice(0, dockerfile.lastIndexOf('\nFROM '));
  const kopie = bau.search(/^COPY \. \.\s*$/m),
    translate = bau.indexOf('scripts/build-ts.js');
  assert.ok(kopie > 0 && kopie < translate, 'Das Bau-Stage kopiert den Kontext nicht ganz vor dem Übersetzen');
  const excluded = fs
    .readFileSync(path.join(ROOT, '.dockerignore'), 'utf8')
    .split('\n')
    .map(z => z.trim())
    .filter(z => z && !z.startsWith('#'))
    .map(z => z.replace(/^\/|\/$/g, ''));
  assert.ok(excluded.includes('node_modules') && excluded.length >= 5, '.dockerignore nicht gelesen');
  for (const ziel of [...dirs, 'server.ts', 'package.json', 'scripts', 'public']) {
    const treffer = excluded.filter(
      m => !m.startsWith('!') && (path.matchesGlob(ziel, m) || path.matchesGlob(`${ziel}/x.ts`, m)),
    );
    assert.deepEqual(treffer, [], `${ziel} wird von .dockerignore ausgeschlossen — im Container fehlt es`);
  }

  // All folders with .ts files on the top level must stand in SRC_DIRS.
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (['node_modules', 'dist', 'data', 'test', 'public', 'scripts', '.git', 'pgdata'].includes(e.name)) continue;
    // Only files from which a runtime module arises. Pure
    // type declarations (.d.ts, e.g. types/augmentations.d.ts) produce no
    // .js and therefore need no SRC_DIRS.
    const hatTs = fs.readdirSync(path.join(ROOT, e.name)).some(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    if (!hatTs) continue;
    assert.ok(
      dirs.includes(e.name),
      `${e.name}/ enthält TypeScript, steht aber nicht in SRC_DIRS — es entsteht ` +
        `kein dist/${e.name}/ und jeder Import darauf läuft beim Start ins Leere`,
    );
  }
});

test('the base schema is looked for where it lies at runtime', () => {
  // My first attempt took APP_ROOT. In the container the sources do not exist —
  // the runtime image only contains dist/. The .sql files end up there because
  // scripts/build-ts.js explicitly copies them along (ASSET_EXT); they must therefore
  // be looked for next to the compiled module, i.e. via __dirname.
  const dbSrc = ohneKommentare(fs.readFileSync(path.join(ROOT, 'db/schemaStart.ts'), 'utf8'));
  const laden = dbSrc.slice(
    dbSrc.indexOf('async function initSchema'),
    dbSrc.indexOf('async function initSchema') + 1200,
  );
  assert.match(
    laden,
    /path\.join\(__dirname, 'base\.sql'\)/,
    'initSchema() sucht db/base.sql nicht über __dirname — im Container liegt die Datei in ' +
      'dist/db/, und einen Quellbaum gibt es dort nicht',
  );
  assert.doesNotMatch(laden, /APP_ROOT/, 'APP_ROOT zeigt auf den Quellbaum, den das Laufzeit-Image nicht enthält');

  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  assert.match(
    build,
    /ASSET_EXT\s*=\s*\[[^\]]*'\.sql'/,
    'Das Bauskript kopiert keine .sql-Dateien mehr nach dist/ — dann fehlt das ' + 'Grundschema im Container',
  );
  assert.ok(fs.existsSync(path.join(ROOT, 'db/base.sql')), 'db/base.sql fehlt');
});

test('every late require() points to a file that exists', () => {
  // A real runtime error during the move
  const treffer = [];
  for (const datei of sources()) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/require\(\s*'(\.[^']+)'\s*\)/g)) {
      const basis = path.resolve(path.dirname(datei), m[1]);
      const da = ['.ts', '.js', '/index.ts', '/index.js', ''].some(e => fs.existsSync(basis + e));
      if (!da) treffer.push(`${path.relative(ROOT, datei)}: require('${m[1]}') zeigt ins Leere`);
    }
  }
  assert.deepEqual(
    treffer,
    [],
    'Ein spätes require() zeigt auf eine Datei, die es nicht gibt. Das fällt ' +
      'erst zur Laufzeit auf — und wenn der Aufruf in einem setImmediate steckt, ' +
      'sogar ausserhalb jedes catch:\n  ' +
      treffer.join('\n  '),
  );
});
