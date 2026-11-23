/**
 * Structure of the frontend: no import cycle, no API call past the shell.
 *
 * Counter-checks (measured on 05.11.2026):
 *   A  in api.js `import { loadGallery } from './sammlung.js'` including
 *      call added → red: “no import cycle”, the cycle names api.js
 *   B  in konten-orte.js `import('./einstellungen.js')` added → red: the
 *      dynamic edge closes a cycle and counts along
 *   C  in einstellungen.js the alert import again via
 *      `fetch('/api/v2/alerts/import/csv', …)` → red: “no fetch past the
 *      shell” with file and line
 *   D  in monitor.js again `export let _monitorTimer` → red: “shared
 *      state only in zustand.js”
 *   E  in bausteine.js `import { loadGallery } from './sammlung.js'` → red:
 *      “core imports no view” (and the cycle test)
 *   G  (08.11.2026) in minifigs.js again `import('./parts.js').ManualPart` as a JSDoc type
 *      (teile.js imports minifigs.js) → red: “no import cycle”, the cycle names both files
 *   H  (11.11.2026) in registry.js (CORE) `import './sammlung.js'` added → red: “core and
 *      building blocks … import no view” names js/registry.js → js/sammlung.js
 *   I  (15.11.2026) in fortschritt.js again `new EventSource(url, { withCredentials: true })` instead of
 *      strom() → red: “no fetch and no EventSource past the API shell” with file and line
 */
const { isAppModule, CORE, BUILDING_BLOCKS } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** Import graph of the bundle: file → imported files (relative to public/). */
function graph() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-graph-'));
  try {
    const meta = path.join(dir, 'meta.json');
    execFileSync(
      path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
      [
        path.join(JS, 'main.js'),
        '--bundle',
        '--format=iife',
        '--log-level=error',
        '--define:__ALLOWED_STYLES__=[]',
        `--metafile=${meta}`,
        `--outfile=${path.join(dir, 'out.js')}`,
      ],
      { cwd: ROOT },
    );
    const { inputs } = JSON.parse(fs.readFileSync(meta, 'utf8'));
    /** @type {Map<string, string[]>} */
    const g = new Map();
    const short = (/** @type {string} */ p) => path.relative(path.join(ROOT, 'public'), path.resolve(ROOT, p));
    for (const [file, info] of Object.entries(inputs))
      g.set(
        short(file),
        info.imports.filter(i => !i.external).map(i => short(i.path)),
      );
    // esbuild deletes JSDoc type references `import('./x.js').Name`; they still bind the files together
    // for the type check, so they count as edges.
    for (const [file, targets] of g) {
      if (!file.startsWith('js/')) continue;
      const source = fs.readFileSync(`${path.join(ROOT, 'public')}/${file}`, 'utf8');
      for (const [, target] of source.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+\.js)['"]\s*\)/g)) {
        const k = short(path.join('public', path.dirname(file), target));
        if (g.has(k) && !targets.includes(k)) targets.push(k);
      }
    }
    return g;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Strongly connected components with more than one node (Tarjan). */
function circles(/** @type {Map<string, string[]>} */ g) {
  let n = 0;
  const index = new Map(),
    deep = new Map(),
    stack = [],
    opened = new Set(),
    result = [];
  const visit = (/** @type {string} */ v) => {
    index.set(v, n);
    deep.set(v, n);
    n++;
    stack.push(v);
    opened.add(v);
    for (const w of g.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        deep.set(v, Math.min(deep.get(v), deep.get(w)));
      } else if (opened.has(w)) deep.set(v, Math.min(deep.get(v), index.get(w)));
    }
    if (deep.get(v) === index.get(v)) {
      const k = [];
      let w;
      do {
        w = stack.pop();
        opened.delete(w);
        k.push(w);
      } while (w !== v);
      if (k.length > 1 || (g.get(v) ?? []).includes(v)) result.push(k.sort());
    }
  };
  for (const v of g.keys()) if (!index.has(v)) visit(v);
  return result;
}

test('the frontend bundle has no import cycle', () => {
  const g = graph();
  const module = [...g.keys()].filter(k => k.startsWith('js/'));
  assert.ok(module.length >= 30, `only ${module.length} modules in the graph — does the analysis still work?`);
  assert.ok([...g.values()].flat().length >= 150, 'hardly any edges in the graph — does the analysis still work?');
  assert.ok(g.has('i18n.js'), 'i18n.js is missing in the graph — it is part of the bundle');
  assert.deepEqual(
    circles(g),
    [],
    'Import cycle in the frontend. Ways back up go via events.js (emit/subscribe) ' +
      'or targets.js (jumpTo), shared state in state.js.',
  );
});

test('core and building blocks (CORE, BUILDING_BLOCKS, i18n.js) import no view', () => {
  const g = graph();
  const layer = new Set([...CORE, ...BUILDING_BLOCKS].map(f => `js/${f}`));
  const lower = (/** @type {string} */ k) => k === 'i18n.js' || layer.has(k);
  const kern = [...g.keys()].filter(lower);
  assert.equal(kern.length, CORE.length + BUILDING_BLOCKS.length, `only ${kern.length} core modules found`);
  const upward = kern.flatMap(k => (g.get(k) ?? []).filter(z => !lower(z)).map(z => `${k} → ${z}`));
  assert.deepEqual(upward, [], 'The core calls views via events or jump targets, not via import');
});

test('shared mutable state only in state.js', () => {
  // An `export let` is a variable every module can read, but whose
  // owner is not fixed. Outside the state module there are
  // read or stop functions instead (manualParts(), stopMonitor()).
  const hits = [];
  for (const f of fs.readdirSync(JS).filter(x => isAppModule(x) && x !== 'state.js')) {
    fs.readFileSync(path.join(JS, f), 'utf8')
      .split('\n')
      .forEach((z, i) => {
        if (/^export\s+let\b/.test(z)) hits.push(`${f}:${i + 1}: ${z.trim()}`);
      });
  }
  assert.ok(/^export let /m.test(fs.readFileSync(path.join(JS, 'state.js'), 'utf8')), 'State module without state?');
  assert.deepEqual(hits, []);
});

test('no fetch and no EventSource bypassing the API wrapper', () => {
  // Exceptions: theme-boot.js runs before the bundle, logviewer.js in its
  // own window with a bearer token; neither can load the shell.
  const EXCEPTIONS = new Set(['theme-boot.js', 'logviewer.js', 'app.bundle.js']);
  const hits = [];
  let seen = 0;
  for (const f of [
    ...fs
      .readdirSync(JS)
      .filter(x => x.endsWith('.js') && !EXCEPTIONS.has(x))
      .map(x => path.join(JS, x)),
    path.join(ROOT, 'public', 'i18n.js'),
  ]) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((z, i) => {
      if (/^\s*(\/\/|\*)/.test(z) || !/\bfetch\(|\bnew EventSource\(/.test(z)) return;
      seen++;
      if (path.basename(f) === 'api.js' && /res = await fetch\('\/api' \+ path, init\)/.test(z)) return;
      if (path.basename(f) === 'api.js' && /es = new EventSource\('\/api' \+ path, /.test(z)) return;
      hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${z.trim()}`);
    });
  }
  assert.ok(seen >= 2, 'Not even the calls in apiRaw() and „strom()“ found — does the search still match?');
  assert.deepEqual(hits, [], 'Calls of the own API go via api(), apiRaw() or „strom()“ (js/api.js)');
});
