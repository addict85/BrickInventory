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
  assert.ok(row, 'SRC_DIRS not found in the build script');
  const dirs = [...row[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(dirs.length >= 5, `only ${dirs.length} source folders — the pattern no longer matches`);
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
    'A quota key contains a path. That is almost certainly a ' +
      'botched replacement — the count would continue at zero under a new name ' +
      'without anything crashing:\n  ' +
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
    'A project module is required without a path — Node then looks for it in ' +
      'node_modules and throws at runtime:\n  ' +
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
  assert.ok(row, 'SRC_DIRS not found');
  assert.match(row[1], /'clients'/, 'The build script does not build clients/');
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
    'Cycle over real import statements — at load time one side is ' +
      'undefined, and that only shows in production:\n  ' +
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
  assert.ok(kopie > 0 && kopie < translate, 'The build stage does not copy the whole context before compiling');
  const excluded = fs
    .readFileSync(path.join(ROOT, '.dockerignore'), 'utf8')
    .split('\n')
    .map(z => z.trim())
    .filter(z => z && !z.startsWith('#'))
    .map(z => z.replace(/^\/|\/$/g, ''));
  assert.ok(excluded.includes('node_modules') && excluded.length >= 5, '.dockerignore not read');
  for (const ziel of [...dirs, 'server.ts', 'package.json', 'scripts', 'public']) {
    const treffer = excluded.filter(
      m => !m.startsWith('!') && (path.matchesGlob(ziel, m) || path.matchesGlob(`${ziel}/x.ts`, m)),
    );
    assert.deepEqual(treffer, [], `${ziel} is excluded by .dockerignore — it is missing in the container`);
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
      `${e.name}/ contains TypeScript but is not in SRC_DIRS — no ` +
        `dist/${e.name}/ is created and every import of it fails at start`,
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
    'initSchema() does not look for db/base.sql via __dirname — in the container the file is in ' +
      'dist/db/, and there is no source tree there',
  );
  assert.doesNotMatch(
    laden,
    /APP_ROOT/,
    'APP_ROOT points to the source tree, which the runtime image does not contain',
  );

  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'), 'utf8');
  assert.match(
    build,
    /ASSET_EXT\s*=\s*\[[^\]]*'\.sql'/,
    'The build script no longer copies .sql files to dist/ — then the ' + 'base schema is missing in the container',
  );
  assert.ok(fs.existsSync(path.join(ROOT, 'db/base.sql')), 'db/base.sql is missing');
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
    'A late require() points to a file that does not exist. That only shows ' +
      'at runtime — and if the call sits in a setImmediate, ' +
      'even outside any catch:\n  ' +
      treffer.join('\n  '),
  );
});
