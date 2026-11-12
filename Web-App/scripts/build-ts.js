#!/usr/bin/env node
'use strict';

/**
 * Transpiliert alle .ts-Dateien nach .js — je Datei, KEIN Bundle, damit die
 * CommonJS-Modulgrenzen bleiben. Für `npm run build` und den Docker-Build;
 * public/ bleibt reines JavaScript.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// Ein fehlender Ordner hier fehlt in dist/, und jeder Import darauf läuft beim Start ins Leere.
const SRC_DIRS = ['db', 'src', 'routes', 'jobs', 'clients', 'startup'];
/**
 * Fassung für den npx-Rückfall.
 *
 * Massgeblich ist die devDependency in package.json — sie wird benutzt, sobald
 * `npm ci` gelaufen ist. Dieser Wert greift nur, wenn jemand das Skript ohne
 * Installation aufruft, und sollte deshalb mit package.json übereinstimmen
 * (test/build-tooling.test.js prüft das).
 */
const ESBUILD_VERSION = '0.28.2';

const outdirArg = process.argv.indexOf('--outdir');
// `--outdir` ohne Wert dahinter ist ein Bedienfehler und ergibt jetzt null
// statt eines Absturzes in path.resolve().
const zielArg = outdirArg !== -1 ? process.argv[outdirArg + 1] : undefined;
const OUTDIR = zielArg ? path.resolve(zielArg) : null;

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

/** Pfad zum esbuild-Programm: lokal aus node_modules/.bin, weil npx je Aufruf
 * Startzeit kostet; npx nur ohne Installation. */
function esbuildCmd() {
  const local = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  if (fs.existsSync(local)) return { cmd: local, prefix: [] };
  return { cmd: 'npx', prefix: ['--yes', `esbuild@${ESBUILD_VERSION}`] };
}

const files = collectTsFiles();
if (!files.length) {
  console.error('[build-ts] Keine .ts-Dateien gefunden.');
  process.exit(1);
}

const { cmd, prefix } = esbuildCmd();
const via = cmd === 'npx' ? `npx esbuild@${ESBUILD_VERSION}` : 'lokalem esbuild';
console.log(`[build-ts] Transpiliere ${files.length} Datei(en) mit ${via}${OUTDIR ? ` → ${OUTDIR}` : ' (in-place)'}`);

// EIN esbuild-Aufruf für alle Dateien: Jeder Prozessstart kostet, auf schwacher
// Hardware genug für die Zeitgrenze der Tests. --outbase erhält die Ordner,
// ohne --bundle bleibt jede Datei ein eigenes Modul.
const outDir = OUTDIR || ROOT;
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  cmd,
  [
    ...prefix,
    ...files,
    '--format=cjs',
    '--platform=node',
    '--target=node20',
    `--outbase=${ROOT}`,
    `--outdir=${outDir}`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

// Nicht-TypeScript-Dateien mitkopieren: Das Laufzeit-Image übernimmt nur dist/,
// ohne die .sql-Migrationen meldete runMigrations() still „nichts zu tun".
const ASSET_EXT = ['.sql', '.txt'];
/** @param {string} dir @param {string} out */
function copyAssets(dir, out) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      n += copyAssets(abs, out);
      continue;
    }
    if (!ASSET_EXT.includes(path.extname(entry.name))) continue;
    const dst = path.join(out, path.relative(ROOT, abs));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(abs, dst);
    n++;
  }
  return n;
}
// Wegräumen, was es in der Quelle nicht mehr gibt: Eine Migration von einem
// anderen Zweig bliebe sonst in dist/ und liefe mit. Gelöscht wird nur, was
// die Umkehrung von copyAssets() als quellenlos ausweist.
/**
 * Verwaiste Abbilder entfernen.
 * @param {string} out Wurzel des Bauziels
 * @returns {string[]} die entfernten Pfade, relativ zu ROOT
 */
function entferneVerwaiste(out) {
  /** @type {string[]} */
  const weg = [];
  /** @param {string} dir */
  function geheDurch(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        geheDurch(abs);
        continue;
      }
      if (!ASSET_EXT.includes(path.extname(entry.name))) continue;
      // Umkehrung von copyAssets(): dst = out + (abs - ROOT)
      const quelle = path.join(ROOT, path.relative(out, abs));
      if (!fs.existsSync(quelle)) {
        fs.unlinkSync(abs);
        weg.push(path.relative(out, abs));
      }
    }
  }
  for (const dir of SRC_DIRS) geheDurch(path.join(out, dir));
  return weg;
}

if (OUTDIR) {
  let assets = 0;
  for (const dir of SRC_DIRS) assets += copyAssets(path.join(ROOT, dir), OUTDIR);
  // tsconfig prüft auch die Skripte (noImplicitAny).
  /** @type {string[]} */
  const weg = entferneVerwaiste(OUTDIR);
  console.log(`[build-ts] ${assets} Nicht-TS-Datei(en) mitkopiert (${ASSET_EXT.join(', ')})`);
  // Namentlich ins Bauprotokoll, damit nichts still verschwindet.
  if (weg.length) console.log(`[build-ts] ${weg.length} verwaiste Datei(en) entfernt: ${weg.join(', ')}`);
  // Die Version gehört zum Bau, nicht in den Arbeitsbaum (scripts/version.js).
  const { bauVersion, schreibe } = require('./version');
  const version = bauVersion();
  schreibe(OUTDIR, version);
  console.log(`[build-ts] Version ${version}`);
}

console.log('[build-ts] Fertig.');
