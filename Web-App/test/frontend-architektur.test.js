/**
 * Aufbau des Frontends: kein Importkreis, kein API-Aufruf an der Hülle vorbei.
 *
 * Der Importgraph kommt vom Bündler selbst (esbuild --metafile), nicht aus
 * einem Muster über den Quelltext: Was esbuild auflöst, wird ausgeliefert —
 * auch ein dynamisches import(). Ein Kreis darin hiesse, dass die
 * Auswertungsreihenfolge vom Einstieg abhängt und ein `const` des anderen
 * Moduls beim Laden noch nicht steht. Rückwege nach oben laufen über
 * 00-ereignisse.js (melde/abonniere) oder 00-ziele.js (springe).
 *
 * Gegenproben (am 05.11.2026 gemessen):
 *   A  in 01-api.js `import { loadGallery } from './02-gallery.js'` samt
 *      Aufruf ergänzt → rot: „kein Importkreis“, der Kreis nennt 01-api.js
 *   B  in 02-konten-orte.js `import('./05-settings.js')` ergänzt → rot: die
 *      dynamische Kante schliesst einen Kreis und zählt mit
 *   C  in 05-settings.js den Alarm-Import wieder per
 *      `fetch('/api/v1/alerts/import/csv', …)` → rot: „kein fetch an der
 *      Hülle vorbei“ mit Datei und Zeile
 *   D  in 01-monitor.js wieder `export let _monitorTimer` → rot: „geteilter
 *      Zustand nur in 00-zustand.js“
 *   E  in 01-bausteine.js `import { loadGallery } from './02-gallery.js'` → rot:
 *      „Kern importiert keine Ansicht“ (und der Kreis-Test)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

/** Importgraph des Bündels: Datei → importierte Dateien (relativ zu public/). */
function graph() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-graph-'));
  try {
    const meta = path.join(dir, 'meta.json');
    execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [
      path.join(JS, 'main.js'), '--bundle', '--format=iife', '--log-level=error',
      '--define:__ERLAUBTE_STILE__=[]', `--metafile=${meta}`, `--outfile=${path.join(dir, 'out.js')}`,
    ], { cwd: ROOT });
    const { inputs } = JSON.parse(fs.readFileSync(meta, 'utf8'));
    /** @type {Map<string, string[]>} */
    const g = new Map();
    const kurz = (/** @type {string} */ p) => path.relative(path.join(ROOT, 'public'), path.resolve(ROOT, p));
    for (const [datei, info] of Object.entries(inputs))
      g.set(kurz(datei), info.imports.filter(i => !i.external).map(i => kurz(i.path)));
    return g;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Stark zusammenhängende Komponenten mit mehr als einem Knoten (Tarjan). */
function kreise(/** @type {Map<string, string[]>} */ g) {
  let n = 0;
  const index = new Map(), tief = new Map(), stapel = [], auf = new Set(), raus = [];
  const besuche = (/** @type {string} */ v) => {
    index.set(v, n); tief.set(v, n); n++; stapel.push(v); auf.add(v);
    for (const w of g.get(v) ?? []) {
      if (!index.has(w)) { besuche(w); tief.set(v, Math.min(tief.get(v), tief.get(w))); }
      else if (auf.has(w)) tief.set(v, Math.min(tief.get(v), index.get(w)));
    }
    if (tief.get(v) === index.get(v)) {
      const k = [];
      let w;
      do { w = stapel.pop(); auf.delete(w); k.push(w); } while (w !== v);
      if (k.length > 1 || (g.get(v) ?? []).includes(v)) raus.push(k.sort());
    }
  };
  for (const v of g.keys()) if (!index.has(v)) besuche(v);
  return raus;
}

test('das Frontend-Bündel hat keinen Importkreis', () => {
  const g = graph();
  const module = [...g.keys()].filter(k => k.startsWith('js/'));
  assert.ok(module.length >= 30, `nur ${module.length} Module im Graphen — greift die Auswertung noch?`);
  assert.ok([...g.values()].flat().length >= 150, 'kaum Kanten im Graphen — greift die Auswertung noch?');
  assert.ok(g.has('i18n.js'), 'i18n.js fehlt im Graphen — es ist Teil des Bündels');
  assert.deepEqual(kreise(g), [],
    'Importkreis im Frontend. Rückwege nach oben über 00-ereignisse.js (melde/abonniere) ' +
    'oder 00-ziele.js (springe), geteilter Zustand in 00-zustand.js.');
});

test('Kern und Bausteine (00-*, 01-*, i18n.js) importieren keine Ansicht', () => {
  const g = graph();
  const unten = (/** @type {string} */ k) => k === 'i18n.js' || /^js\/0[01]-/.test(k);
  const kern = [...g.keys()].filter(unten);
  assert.ok(kern.length >= 12, `nur ${kern.length} Kernmodule gefunden`);
  const aufwaerts = kern.flatMap(k => (g.get(k) ?? []).filter(z => !unten(z)).map(z => `${k} → ${z}`));
  assert.deepEqual(aufwaerts, [], 'Der Kern ruft Ansichten über Ereignisse oder Sprungziele, nicht per Import');
});

test('geteilter veränderlicher Zustand nur in 00-zustand.js', () => {
  // Ein `export let` ist eine Variable, die jedes Modul lesen kann, deren
  // Besitzer aber nicht feststeht. Ausserhalb des Zustandsmoduls gibt es
  // stattdessen Lese- oder Stoppfunktionen (manuelleTeile(), stoppeMonitor()).
  const treffer = [];
  for (const f of fs.readdirSync(JS).filter(x => /^\d\d-.*\.js$/.test(x) && x !== '00-zustand.js')) {
    fs.readFileSync(path.join(JS, f), 'utf8').split('\n').forEach((z, i) => {
      if (/^export\s+let\b/.test(z)) treffer.push(`${f}:${i + 1}: ${z.trim()}`);
    });
  }
  assert.ok(/^export let /m.test(fs.readFileSync(path.join(JS, '00-zustand.js'), 'utf8')), 'Zustandsmodul ohne Zustand?');
  assert.deepEqual(treffer, []);
});

test('kein fetch an der API-Hülle vorbei', () => {
  // Ausnahmen: 00-theme-boot.js läuft vor dem Bündel, logviewer.js in einem
  // eigenen Fenster mit Bearer-Token; beide können die Hülle nicht laden.
  const AUSNAHMEN = new Set(['00-theme-boot.js', 'logviewer.js', 'app.bundle.js']);
  const treffer = [];
  let gesehen = 0;
  for (const f of [...fs.readdirSync(JS).filter(x => x.endsWith('.js') && !AUSNAHMEN.has(x)).map(x => path.join(JS, x)),
                   path.join(ROOT, 'public', 'i18n.js')]) {
    const zeilen = fs.readFileSync(f, 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      if (/^\s*(\/\/|\*)/.test(z) || !/\bfetch\(/.test(z)) return;
      gesehen++;
      if (path.basename(f) === '01-api.js' && /res = await fetch\('\/api' \+ path, init\)/.test(z)) return;
      treffer.push(`${path.relative(ROOT, f)}:${i + 1}: ${z.trim()}`);
    });
  }
  assert.ok(gesehen >= 1, 'Nicht einmal der Aufruf in apiRoh() gefunden — greift die Suche noch?');
  assert.deepEqual(treffer, [], 'Aufrufe der eigenen API gehen über api() oder apiRoh() (js/01-api.js)');
});
