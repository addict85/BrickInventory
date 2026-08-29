#!/usr/bin/env node
'use strict';

/**
 * Transpiliert alle .ts-Dateien (server.ts, db/, utils/, routes/, jobs/) nach .js —
 * pro Datei einzeln, KEIN Bundle. Das erhält die CommonJS-Modulgrenzen 1:1,
 * sodass die require()-Aufrufe aus jobs/*.js (bleiben JS) und die
 * `export = Object.assign(router, {...})`-Router unverändert funktionieren.
 *
 * Genutzt von `npm run build` (lokal) und im Docker-Build (gleiche Logik).
 * public/ bleibt reines JavaScript und wird hier NICHT angefasst.
 *
 * Aufruf:
 *   node scripts/build-ts.js            → schreibt .js neben die .ts (in-place)
 *   node scripts/build-ts.js --outdir X → schreibt nach X/ (Verzeichnisbaum erhalten)
 */

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
// 'jobs' seit der Migration nach TypeScript (Punkt 10): Ohne den Eintrag
// entstünden keine .js-Dateien und jedes require('./jobs/...') liefe ins Leere.
// 'clients' seit Nachtrag 126: rebrickable.ts und brickset.ts sind API-Clients
// ohne eine einzige Route und lagen nur aus Gewohnheit in routes/. Fehlt der
// Eintrag hier, entsteht kein dist/clients/ — und JEDER Import darauf läuft
// beim Start ins Leere. Genau daran wäre der Umzug fast gescheitert.
// 'startup' seit Nachtrag 134 (die Staffel der Hintergrundläufe).
const SRC_DIRS = ['db', 'utils', 'routes', 'jobs', 'clients', 'startup'];
/**
 * Fassung für den npx-Rückfall.
 *
 * Massgeblich ist die devDependency in package.json — sie wird benutzt, sobald
 * `npm ci` gelaufen ist. Dieser Wert greift nur, wenn jemand das Skript ohne
 * Installation aufruft, und sollte deshalb mit package.json übereinstimmen
 * (test/build-tooling.test.js prüft das).
 */
const ESBUILD_VERSION = '0.25.12';

const outdirArg = process.argv.indexOf('--outdir');
const OUTDIR = outdirArg !== -1 ? path.resolve(process.argv[outdirArg + 1]) : null;

/** @param {string} dir @param {string[]} out */
function walkTs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // node_modules o. Ä. gibt es in den SRC_DIRS nicht, aber sicher ist sicher
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkTs(abs, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
}

function collectTsFiles() {
  const files = [];
  const server = path.join(ROOT, 'server.ts');
  if (fs.existsSync(server)) files.push(server);
  for (const dir of SRC_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    // rekursiv, damit Unterordner wie routes/api_v1/ mit erfasst werden
    walkTs(abs, files);
  }
  return files;
}

/** @param {string} tsFile */
function outPathFor(tsFile) {
  const rel = path.relative(ROOT, tsFile).replace(/\.ts$/, '.js');
  return OUTDIR ? path.join(OUTDIR, rel) : path.join(ROOT, rel);
}


/**
 * Pfad zum esbuild-Programm.
 *
 * ── Warum nicht mehr npx ────────────────────────────────────────────────────
 * Hier stand `npx --yes esbuild@<Version>`. Das war aus der Zeit, als esbuild
 * keine devDependency war — npx lud es dann bei Bedarf. Inzwischen steht es in
 * package.json und liegt nach `npm ci` lokal unter node_modules/.bin/.
 *
 * npx kostet pro Aufruf mehrere hundert Millisekunden Startzeit und prüft je
 * nach Lage die Registry. Bei 58 Dateien und mehreren Testdateien, die den
 * Build jeweils erneut anstossen, summiert sich das auf Minuten — auf einem
 * Raspberry Pi genug für die 60-Sekunden-Grenze des Test-Runners.
 *
 * Der Rückfall auf npx bleibt für den Fall, dass jemand das Skript ohne
 * vorherige Installation aufruft.
 */
function esbuildCmd() {
  const local = path.join(ROOT, 'node_modules', '.bin',
    process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  if (fs.existsSync(local)) return { cmd: local, prefix: [] };
  return { cmd: 'npx', prefix: ['--yes', `esbuild@${ESBUILD_VERSION}`] };
}

const files = collectTsFiles();
if (!files.length) { console.error('[build-ts] Keine .ts-Dateien gefunden.'); process.exit(1); }

const { cmd, prefix } = esbuildCmd();
const via = cmd === 'npx' ? `npx esbuild@${ESBUILD_VERSION}` : 'lokalem esbuild';
console.log(`[build-ts] Transpiliere ${files.length} Datei(en) mit ${via}${OUTDIR ? ` → ${OUTDIR}` : ' (in-place)'}`);

// EIN esbuild-Aufruf für alle Dateien statt einer je Datei.
//
// esbuild nimmt beliebig viele Eingabedateien entgegen und schreibt sie mit
// --outdir in den Zielbaum; --outbase erhält dabei die Verzeichnisstruktur
// (db/, routes/api_v1/, …). Vorher lief das Programm 58-mal — jeder Start
// kostet Prozesserzeugung, und über npx zusätzlich dessen Auflösung. Gemessen
// auf einem Raspberry Pi war das der Grund, warum neun Testdateien in die
// 60-Sekunden-Grenze liefen, obwohl inhaltlich nichts falsch war.
//
// Kein Bundle: --format=cjs ohne --bundle transpiliert jede Datei einzeln und
// lässt die require()-Aufrufe stehen. Die Modulgrenzen bleiben damit exakt wie
// bisher — nur eben in einem Durchlauf.
const outDir = OUTDIR || ROOT;
fs.mkdirSync(outDir, { recursive: true });
execFileSync(cmd, [
  ...prefix, ...files,
  '--format=cjs', '--platform=node', '--target=node20',
  `--outbase=${ROOT}`, `--outdir=${outDir}`,
], { stdio: ['ignore', 'ignore', 'inherit'] });

// ── Nicht-TypeScript-Dateien mitkopieren ────────────────────────────────────
//
// esbuild verarbeitet nur .ts. Die Migrationen in db/migrations/ sind aber
// .sql-Dateien — sie landeten dadurch NIE im Build, und weil das
// Laufzeit-Image ausschliesslich dist/ übernimmt, fand runMigrations() dort
// gar kein Verzeichnis vor und meldete "nichts zu tun".
//
// Die Folge war still und schwer zu finden: Die Datenbank behielt die alten
// Pfade, und der davon abhängige (inzwischen entfernte) Dateiumzug ordnete jede
// Datei als "verwaist" ein — die Bilder blieben liegen, ohne dass irgendetwas
// fehlschlug.
const ASSET_EXT = ['.sql'];
/** @param {string} dir @param {string} out */
function copyAssets(dir, out) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { n += copyAssets(abs, out); continue; }
    if (!ASSET_EXT.includes(path.extname(entry.name))) continue;
    const dst = path.join(out, path.relative(ROOT, abs));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(abs, dst);
    n++;
  }
  return n;
}
if (OUTDIR) {
  let assets = 0;
  for (const dir of SRC_DIRS) assets += copyAssets(path.join(ROOT, dir), OUTDIR);
  console.log(`[build-ts] ${assets} Nicht-TS-Datei(en) mitkopiert (${ASSET_EXT.join(', ')})`);
}

console.log('[build-ts] Fertig.');
