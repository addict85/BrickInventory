#!/usr/bin/env node
'use strict';

/**
 * Bundles and minifies the frontend.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
/**
 * Version for the npx fallback.
 *
 * What counts is the devDependency in package.json — it is used as soon as
 * `npm ci` has run. This value only applies when someone calls the script without
 * installation, and should therefore match package.json
 * (test/build-tooling.test.js checks that).
 */
const ESBUILD_VERSION = '0.28.2';

/** Entry point — imports all parts in the previous order. */
const ENTRY = 'js/main.js';
const OUT_REL = 'js/app.bundle.js';

/**
 * Files under public/js/ that do NOT go through the entry point.
 * Every other .js there must be imported by js/main.js — otherwise it is
 * never delivered, and that is only noticed in the browser.
 */
const STANDALONE = new Set([
  'theme-boot.js', // classic script in the <head>, before the first paint
  'pdfjs-boot.js', // own ES module with type="module"
  'logviewer.js', // is loaded into the popup at runtime
  'main.js', // the entry point itself
  path.basename(OUT_REL),
]);

/**
 * Layers of the UI. The file name says what a module does, not where it
 * lives; the layer is therefore listed here, and test/frontend-architektur.test.js
 * checks that core and building blocks import no view. Everything else is a view.
 */
const CORE = [
  'styles.js',
  'escaping.js',
  'events.js',
  'targets.js',
  'state.js',
  'load-guard.js',
  'registry.js',
  'theme-boot.js',
];
const BUILDING_BLOCKS = [
  'dom.js',
  'format.js',
  'messages.js',
  'connection.js',
  'api.js',
  'images.js',
  'form.js',
  'account.js',
  'dialogs.js',
  'progress.js',
  'monitor.js',
  'components.js',
  'confirm-prompt.js',
  'crosshair.js',
  'charts.js',
  // Shared by several views without being a view itself (no tab, no screen of its own).
  'account-filter.js',
  'purchase-price-display.js',
  'scrollbar.js',
  'entry-state.js',
  'router.js',
  'detail-fields.js',
  'account-locations.js',
  'trash.js',
  'deletion.js',
  'metrics.js',
  // The panel for links from mails before login; the login mask (session.js) shows it.
  'mail-link.js',
];

/** Outside the app modules: entry point, bundle and the standalone scripts without relation to the bundle. */
const NO_APP_MODULE = new Set(['main.js', path.basename(OUT_REL), 'logviewer.js', 'pdfjs-boot.js']);

/** Whether a file name under public/js is a module of the UI (core, building blocks, views). */
const isAppModule = (/** @type {string} */ f) => f.endsWith('.js') && !NO_APP_MODULE.has(f);

/** The UI modules under public/js, sorted. */
function appModule() {
  return fs.readdirSync(path.join(PUBLIC, 'js')).filter(isAppModule).sort();
}

/**
 * Checks that every file either hangs in the module graph or is deliberately
 * excluded, and that the layer lists only name files that exist.
 * A newly created .js that nobody imports would otherwise silently be missing.
 */
function checkComplete() {
  const missing = [...CORE, ...BUILDING_BLOCKS].filter(f => !fs.existsSync(path.join(PUBLIC, 'js', f)));
  if (missing.length) {
    console.error(`[build-frontend] CORE/BUILDING_BLOCKS nennen fehlende Dateien: ${missing.join(', ')}`);
    process.exit(1);
  }
  const entry = fs.readFileSync(path.join(PUBLIC, ENTRY), 'utf8');
  const imported = new Set([...entry.matchAll(/from\s+'\.\/([^']+)'|import\s+'\.\/([^']+)'/g)].map(m => m[1] || m[2]));
  const actual = fs.readdirSync(path.join(PUBLIC, 'js')).filter(f => f.endsWith('.js'));
  const orphans = actual.filter(f => !STANDALONE.has(f) && !imported.has(f) && f !== 'registry.js');
  if (orphans.length) {
    console.error(`[build-frontend] Nicht im Modulgraphen: ${orphans.join(', ')}`);
    console.error('[build-frontend] In js/main.js importieren oder in STANDALONE eintragen.');
    process.exit(1);
  }
}

/**
 * All style values that stand like this in the source: data-style="…" in the markup and the
 * style parameters of the building blocks (components.js). js/styles.js only applies
 * these — an injected data-style with a different value stays ineffective.
 * Values with `${…}` do not count; the caller sets those itself at runtime.
 */
function allowedStyles() {
  const files = [
    'index.html',
    ...fs
      .readdirSync(path.join(PUBLIC, 'js'))
      .filter(f => f.endsWith('.js') && f !== path.basename(OUT_REL))
      .map(f => 'js/' + f),
  ];
  const values = new Set();
  /** @type {Record<string, string>} */
  const entity = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
  for (const d of files) {
    const s = fs.readFileSync(path.join(PUBLIC, d), 'utf8');
    for (const m of s.matchAll(/data-style=(\\?["'])([\s\S]*?)\1/g)) {
      const raw = m[2] ?? '';
      if (!raw.includes('${'))
        values.add(raw.replace(/\\(["'])/g, '$1').replace(/&(amp|quot|#39|lt|gt);/g, e => entity[e] ?? e));
    }
    for (const m of s.matchAll(/\b(?:style|rowsStyle|valueStyle):\s*'([^'$]*)'/g)) values.add(m[1] ?? '');
  }
  return [...values].sort();
}

/** Bundles to `outAbs` (delivery, test-run.js). */
/**
 * @param {string} outAbs
 * @param {{ sourceMap?: boolean }} [opt]  sourceMap: source map embedded, only for the
 *   coverage measurement (test-run.js --abdeckung); the delivered bundle stays without.
 */
function buildBundle(outAbs, opt = {}) {
  // Local esbuild instead of npx — see the reasoning in scripts/build-ts.js.
  const local = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  const [cmd, prefix] = fs.existsSync(local) ? [local, []] : ['npx', ['--yes', `esbuild@${ESBUILD_VERSION}`]];
  execFileSync(
    cmd,
    [
      ...prefix,
      path.join(PUBLIC, ENTRY),
      '--bundle',
      '--format=iife',
      ...(opt.sourceMap ? [] : ['--minify']),
      '--charset=utf8',
      `--define:__ALLOWED_STYLES__=${JSON.stringify(allowedStyles())}`,
      `--outfile=${outAbs}`,
      ...(opt.sourceMap ? ['--sourcemap=inline', '--sources-content=true'] : []),
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

/** Most recent change to everything the bundle is built from (also index.html: data-style values). */
function newestSource() {
  const files = [
    ...fs
      .readdirSync(path.join(PUBLIC, 'js'))
      .filter(f => f.endsWith('.js') && f !== path.basename(OUT_REL))
      .map(f => path.join(PUBLIC, 'js', f)),
    ...fs.readdirSync(path.join(PUBLIC, 'locales')).map(f => path.join(PUBLIC, 'locales', f)),
    path.join(PUBLIC, 'i18n.js'),
    path.join(PUBLIC, 'index.html'),
    __filename,
  ];
  return Math.max(...files.map(f => fs.statSync(f).mtimeMs));
}

/**
 * The bundle is not in git; whoever reads it calls this. Via a temporary file
 * and rename, so that parallel readers never see half of one. true if a build happened.
 * @param {string} [outAbs]
 */
function placeBundleSafe(outAbs = path.join(PUBLIC, OUT_REL)) {
  if (fs.existsSync(outAbs) && fs.statSync(outAbs).mtimeMs >= newestSource()) return false;
  const temp = `${outAbs}.${process.pid}.tmp`;
  try {
    buildBundle(temp);
    fs.renameSync(temp, outAbs);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return true;
}

function main() {
  checkComplete();
  if (process.argv.includes('--check')) {
    console.log('[build-frontend] Dateizuordnung vollständig.');
    return;
  }

  // --outfile=…: only bundle, to a different place (test/bundle-built.test.js).
  const target = process.argv.find(a => a.startsWith('--outfile='))?.slice('--outfile='.length);
  if (target) {
    buildBundle(path.resolve(target));
    return;
  }
  const outAbs = path.join(PUBLIC, OUT_REL);
  buildBundle(outAbs);

  const after = fs.statSync(outAbs).size;
  console.log(`[build-frontend] ${ENTRY} → ${OUT_REL}: ${(after / 1024).toFixed(0)} KB`);

  const pdfjs = require('./copy-pdfjs').copyPdfjs();
  if (pdfjs) console.log(`[build-frontend] PDF.js ${pdfjs} aus pdfjs-dist → public/vendor/pdfjs/`);
  const qr = require('./copy-qrcode').copyQrcode();
  if (qr) console.log(`[build-frontend] QRCode.js ${qr} aus qrcodejs → public/vendor/qrcode/`);
}

if (require.main === module) main();

module.exports = {
  ENTRY,
  OUT_REL,
  STANDALONE,
  CORE,
  BUILDING_BLOCKS,
  isAppModule,
  appModule,
  allowedStyles,
  buildBundle,
  placeBundleSafe,
  newestSource,
};
