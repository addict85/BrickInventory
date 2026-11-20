#!/usr/bin/env node
'use strict';

/**
 * Transpiles all .ts files to .js — per file, NO bundle, so that the
 * CommonJS module boundaries stay. For `npm run build` and the Docker build;
 * public/ stays plain JavaScript.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// A folder missing here is missing in dist/, and every import of it runs into nothing at startup.
const SRC_DIRS = ['db', 'src', 'routes', 'jobs', 'clients', 'startup'];
/**
 * Version for the npx fallback.
 *
 * What counts is the devDependency in package.json — it is used as soon as
 * `npm ci` has run. This value only applies when someone calls the script without
 * installation, and should therefore match package.json
 * (test/build-tooling.test.js checks that).
 */
const ESBUILD_VERSION = '0.28.2';

const outdirArg = process.argv.indexOf('--outdir');
// `--outdir` without a value after it is an operating error and now yields null
// instead of a crash in path.resolve().
const targetArg = outdirArg !== -1 ? process.argv[outdirArg + 1] : undefined;
const OUTDIR = targetArg ? path.resolve(targetArg) : null;

/** @param {string} dir @param {string[]} out */
function walkTs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // node_modules or similar does not exist in SRC_DIRS, but better safe than sorry
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
    // recursively, so that subfolders like routes/api_v1/ are included
    walkTs(abs, files);
  }
  return files;
}

/** Path to the esbuild program: local from node_modules/.bin, because npx costs startup time
 * per call; npx only without installation. */
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

// ONE esbuild call for all files: every process start costs, on weak
// hardware enough for the tests' time limit. --outbase keeps the folders,
// without --bundle every file stays a module of its own.
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

// Copy non-TypeScript files along: the runtime image only takes dist/,
// without the .sql migrations runMigrations() silently reported "nothing to do".
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
// Clear away what no longer exists in the source: a migration from another
// branch would otherwise stay in dist/ and run along. Only what the inversion
// of copyAssets() identifies as sourceless is deleted.
/**
 * Remove orphaned copies.
 * @param {string} out root of the build target
 * @returns {string[]} the removed paths, relative to ROOT
 */
function removeOrphaned(out) {
  /** @type {string[]} */
  const weg = [];
  /** @param {string} dir */
  function goBy(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        goBy(abs);
        continue;
      }
      if (!ASSET_EXT.includes(path.extname(entry.name))) continue;
      // Inversion of copyAssets(): dst = out + (abs - ROOT)
      const quelle = path.join(ROOT, path.relative(out, abs));
      if (!fs.existsSync(quelle)) {
        fs.unlinkSync(abs);
        weg.push(path.relative(out, abs));
      }
    }
  }
  for (const dir of SRC_DIRS) goBy(path.join(out, dir));
  return weg;
}

if (OUTDIR) {
  let assets = 0;
  for (const dir of SRC_DIRS) assets += copyAssets(path.join(ROOT, dir), OUTDIR);
  // tsconfig also checks the scripts (noImplicitAny).
  /** @type {string[]} */
  const weg = removeOrphaned(OUTDIR);
  console.log(`[build-ts] ${assets} Nicht-TS-Datei(en) mitkopiert (${ASSET_EXT.join(', ')})`);
  // By name into the build log, so that nothing disappears silently.
  if (weg.length) console.log(`[build-ts] ${weg.length} verwaiste Datei(en) entfernt: ${weg.join(', ')}`);
  // The version belongs to the build, not into the working tree (scripts/version.js).
  const { buildVersion, schreibe } = require('./version');
  const version = buildVersion();
  schreibe(OUTDIR, version);
  console.log(`[build-ts] Version ${version}`);
}

console.log('[build-ts] Fertig.');
