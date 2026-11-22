#!/usr/bin/env node
'use strict';

/**
 * PDF.js comes from the npm dependency pdfjs-dist (exact version in
 * package.json), so that npm audit and Dependabot see it. This script puts the
 * two files into public/vendor/pdfjs/ and updates the version in the
 * cache buster of public/js/pdfjs-boot.js; build-frontend.js calls it.
 *
 *   node scripts/copy-pdfjs.js [target root]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATEIEN = ['pdf.min.mjs', 'pdf.worker.min.mjs'];

/** @returns the copied version, or null without an installed pdfjs-dist */
function copyPdfjs(ziel = ROOT, quelle = ROOT) {
  const paket = path.join(quelle, 'node_modules', 'pdfjs-dist');
  if (!fs.existsSync(path.join(paket, 'package.json'))) return null;
  const fassung = JSON.parse(fs.readFileSync(path.join(paket, 'package.json'), 'utf8')).version;
  const ordner = path.join(ziel, 'public', 'vendor', 'pdfjs');
  fs.mkdirSync(ordner, { recursive: true });
  for (const d of DATEIEN) fs.copyFileSync(path.join(paket, 'build', d), path.join(ordner, d));
  const boot = path.join(ziel, 'public', 'js', 'pdfjs-boot.js');
  const alt = fs.readFileSync(boot, 'utf8');
  const neu = alt.replace(/(\/vendor\/pdfjs\/[\w.]+\.mjs\?v=)[\w.-]+/g, `$1${fassung}`);
  if (neu !== alt) fs.writeFileSync(boot, neu);
  return fassung;
}

module.exports = { copyPdfjs, DATEIEN };

if (require.main === module) {
  const fassung = copyPdfjs(process.argv[2] ? path.resolve(process.argv[2]) : ROOT);
  console.log(
    fassung
      ? `[pdfjs] ${fassung} → public/vendor/pdfjs/`
      : '[pdfjs] pdfjs-dist nicht installiert — die eingecheckten Dateien bleiben',
  );
}
