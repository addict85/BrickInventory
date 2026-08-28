#!/usr/bin/env node
'use strict';

/**
 * Bündelt und minifiziert das Frontend.
 *
 * ── Von Verkettung zu echtem Bundling ───────────────────────────────────────
 * Vorher wurden die Dateien nur ANEINANDERGEHÄNGT, weil sie sich einen globalen
 * Namensraum teilten und ein Modul-Bundler die gegenseitigen Zugriffe zerrissen
 * hätte. Seit der Umstellung auf ES-Module ist das anders: Jede Datei benennt
 * ihre Importe und Exporte, und esbuild löst den Graphen selbst auf.
 *
 * Das bringt drei Dinge, die die Verkettung nicht konnte:
 *   • Tree-Shaking — ungenutzte Exporte fallen raus.
 *   • Echte Modulgrenzen — ein `const x` in einer Datei kollidiert nicht mehr
 *     mit einem gleichnamigen in einer anderen (genau so hat sich der Fehler
 *     "PARTS_ICON_SVG ist schon deklariert" seinerzeit gezeigt).
 *   • Die Auswertungsreihenfolge folgt dem Importgraphen statt der
 *     Dateinamen-Nummerierung.
 *
 * Ausgabe ist bewusst format=iife und KEIN type="module" im Browser: Das
 * Bündel läuft damit als ein einziges klassisches Skript, was die
 * Ladereihenfolge gegenüber 00-theme-boot.js und den Sprachdateien unverändert
 * lässt.
 *
 * Aufruf:
 *   node scripts/build-frontend.js          → public/js/app.bundle.js
 *   node scripts/build-frontend.js --check  → prüft nur die Dateizuordnung
 */

const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
/**
 * Fassung für den npx-Rückfall.
 *
 * Massgeblich ist die devDependency in package.json — sie wird benutzt, sobald
 * `npm ci` gelaufen ist. Dieser Wert greift nur, wenn jemand das Skript ohne
 * Installation aufruft, und sollte deshalb mit package.json übereinstimmen
 * (test/build-tooling.test.js prüft das).
 */
const ESBUILD_VERSION = '0.25.12';

/** Einstiegspunkt — importiert alle Teile in der bisherigen Reihenfolge. */
const ENTRY   = 'js/main.js';
const OUT_REL = 'js/app.bundle.js';

/**
 * Dateien unter public/js/, die NICHT über den Einstiegspunkt laufen.
 * Jede andere .js dort muss von js/main.js importiert werden — sonst wird sie
 * nie ausgeliefert, und das fällt erst im Browser auf.
 */
const STANDALONE = new Set([
  '00-theme-boot.js',   // klassisches Skript im <head>, vor dem ersten Paint
  'pdfjs-boot.js',      // eigenes ES-Modul mit type="module"
  'logviewer.js',       // wird zur Laufzeit ins Popup nachgeladen
  'main.js',            // der Einstiegspunkt selbst
  path.basename(OUT_REL),
]);

/**
 * Prüft, dass jede Datei entweder im Modulgraphen hängt oder bewusst
 * ausgenommen ist. Eine neu angelegte 12-*.js, die niemand importiert, würde
 * sonst stillschweigend fehlen.
 */
function checkComplete() {
  const entry = fs.readFileSync(path.join(PUBLIC, ENTRY), 'utf8');
  const imported = new Set(
    [...entry.matchAll(/from\s+'\.\/([^']+)'|import\s+'\.\/([^']+)'/g)]
      .map(m => m[1] || m[2]));
  const actual = fs.readdirSync(path.join(PUBLIC, 'js')).filter(f => f.endsWith('.js'));
  const orphans = actual.filter(f => !STANDALONE.has(f) && !imported.has(f) && f !== '00-registry.js');
  if (orphans.length) {
    console.error(`[build-frontend] Nicht im Modulgraphen: ${orphans.join(', ')}`);
    console.error('[build-frontend] In js/main.js importieren oder in STANDALONE eintragen.');
    process.exit(1);
  }
}

function main() {
  checkComplete();
  if (process.argv.includes('--check')) {
    console.log('[build-frontend] Dateizuordnung vollständig.');
    return;
  }

  // Lokales esbuild statt npx — siehe die Begründung in scripts/build-ts.js.
  const local = path.join(ROOT, 'node_modules', '.bin',
    process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  const [cmd, prefix] = fs.existsSync(local)
    ? [local, []]
    : ['npx', ['--yes', `esbuild@${ESBUILD_VERSION}`]];

  const outAbs = path.join(PUBLIC, OUT_REL);
  execFileSync(cmd, [
    ...prefix, path.join(PUBLIC, ENTRY),
    '--bundle', '--format=iife', '--minify', '--charset=utf8',
    `--outfile=${outAbs}`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  const after = fs.statSync(outAbs).size;
  console.log(`[build-frontend] ${ENTRY} → ${OUT_REL}: ${(after / 1024).toFixed(0)} KB`);
}

if (require.main === module) main();

module.exports = { ENTRY, OUT_REL, STANDALONE };
