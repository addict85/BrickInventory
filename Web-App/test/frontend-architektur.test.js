/**
 * Structure of the frontend: no import cycle, no API call past the shell.
 *
 * Counter-checks (measured on 05.11.2026):
 *   A  in api.js `import { loadGallery } from './sammlung.js'` including
 *      call added → red: “no import cycle”, the cycle names api.js
 *   B  in konten-orte.js `import('./einstellungen.js')` added → red: the
 *      dynamic edge closes a cycle and counts along
 *   C  in einstellungen.js the alert import again via
 *      `fetch('/api/v1/alerts/import/csv', …)` → red: “no fetch past the
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
    const kurz = (/** @type {string} */ p) => path.relative(path.join(ROOT, 'public'), path.resolve(ROOT, p));
    for (const [datei, info] of Object.entries(inputs))
      g.set(
        kurz(datei),
        info.imports.filter(i => !i.external).map(i => kurz(i.path)),
      );
    // esbuild deletes JSDoc type references `import('./x.js').Name`; they still bind the files together
    // for the type check, so they count as edges.
    for (const [datei, ziele] of g) {
      if (!datei.startsWith('js/')) continue;
      const quelle = fs.readFileSync(`${path.join(ROOT, 'public')}/${datei}`, 'utf8');
      for (const [, ziel] of quelle.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+\.js)['"]\s*\)/g)) {
        const k = kurz(path.join('public', path.dirname(datei), ziel));
        if (g.has(k) && !ziele.includes(k)) ziele.push(k);
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
    tief = new Map(),
    stapel = [],
    auf = new Set(),
    raus = [];
  const visit = (/** @type {string} */ v) => {
    index.set(v, n);
    tief.set(v, n);
    n++;
    stapel.push(v);
    auf.add(v);
    for (const w of g.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        tief.set(v, Math.min(tief.get(v), tief.get(w)));
      } else if (auf.has(w)) tief.set(v, Math.min(tief.get(v), index.get(w)));
    }
    if (tief.get(v) === index.get(v)) {
      const k = [];
      let w;
      do {
        w = stapel.pop();
        auf.delete(w);
        k.push(w);
      } while (w !== v);
      if (k.length > 1 || (g.get(v) ?? []).includes(v)) raus.push(k.sort());
    }
  };
  for (const v of g.keys()) if (!index.has(v)) visit(v);
  return raus;
}

test('the frontend bundle has no import cycle', () => {
  const g = graph();
  const module = [...g.keys()].filter(k => k.startsWith('js/'));
  assert.ok(module.length >= 30, `nur ${module.length} Module im Graphen — greift die Auswertung noch?`);
  assert.ok([...g.values()].flat().length >= 150, 'kaum Kanten im Graphen — greift die Auswertung noch?');
  assert.ok(g.has('i18n.js'), 'i18n.js fehlt im Graphen — es ist Teil des Bündels');
  assert.deepEqual(
    circles(g),
    [],
    'Importkreis im Frontend. Rückwege nach oben über events.js (emit/subscribe) ' +
      'oder targets.js (jumpTo), geteilter Zustand in state.js.',
  );
});

test('core and building blocks (CORE, BUILDING_BLOCKS, i18n.js) import no view', () => {
  const g = graph();
  const layer = new Set([...CORE, ...BUILDING_BLOCKS].map(f => `js/${f}`));
  const unten = (/** @type {string} */ k) => k === 'i18n.js' || layer.has(k);
  const kern = [...g.keys()].filter(unten);
  assert.equal(kern.length, CORE.length + BUILDING_BLOCKS.length, `nur ${kern.length} Kernmodule gefunden`);
  const aufwaerts = kern.flatMap(k => (g.get(k) ?? []).filter(z => !unten(z)).map(z => `${k} → ${z}`));
  assert.deepEqual(aufwaerts, [], 'Der Kern ruft Ansichten über Ereignisse oder Sprungziele, nicht per Import');
});

test('shared mutable state only in state.js', () => {
  // An `export let` is a variable every module can read, but whose
  // owner is not fixed. Outside the state module there are
  // read or stop functions instead (manualParts(), stopMonitor()).
  const treffer = [];
  for (const f of fs.readdirSync(JS).filter(x => isAppModule(x) && x !== 'state.js')) {
    fs.readFileSync(path.join(JS, f), 'utf8')
      .split('\n')
      .forEach((z, i) => {
        if (/^export\s+let\b/.test(z)) treffer.push(`${f}:${i + 1}: ${z.trim()}`);
      });
  }
  assert.ok(/^export let /m.test(fs.readFileSync(path.join(JS, 'state.js'), 'utf8')), 'Zustandsmodul ohne Zustand?');
  assert.deepEqual(treffer, []);
});

test('no fetch and no EventSource bypassing the API wrapper', () => {
  // Exceptions: theme-boot.js runs before the bundle, logviewer.js in its
  // own window with a bearer token; neither can load the shell.
  const EXCEPTIONS = new Set(['theme-boot.js', 'logviewer.js', 'app.bundle.js']);
  const treffer = [];
  let gesehen = 0;
  for (const f of [
    ...fs
      .readdirSync(JS)
      .filter(x => x.endsWith('.js') && !EXCEPTIONS.has(x))
      .map(x => path.join(JS, x)),
    path.join(ROOT, 'public', 'i18n.js'),
  ]) {
    const zeilen = fs.readFileSync(f, 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      if (/^\s*(\/\/|\*)/.test(z) || !/\bfetch\(|\bnew EventSource\(/.test(z)) return;
      gesehen++;
      if (path.basename(f) === 'api.js' && /res = await fetch\('\/api' \+ path, init\)/.test(z)) return;
      if (path.basename(f) === 'api.js' && /es = new EventSource\('\/api' \+ path, /.test(z)) return;
      treffer.push(`${path.relative(ROOT, f)}:${i + 1}: ${z.trim()}`);
    });
  }
  assert.ok(gesehen >= 2, 'Nicht einmal die Aufrufe in apiRaw() und strom() gefunden — greift die Suche noch?');
  assert.deepEqual(treffer, [], 'Aufrufe der eigenen API gehen über api(), apiRaw() oder strom() (js/api.js)');
});
