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
function copyPdfjs(target = ROOT, source = ROOT) {
  const pkg = path.join(source, 'node_modules', 'pdfjs-dist');
  if (!fs.existsSync(path.join(pkg, 'package.json'))) return null;
  const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
  const folder = path.join(target, 'public', 'vendor', 'pdfjs');
  fs.mkdirSync(folder, { recursive: true });
  for (const d of DATEIEN) fs.copyFileSync(path.join(pkg, 'build', d), path.join(folder, d));
  const boot = path.join(target, 'public', 'js', 'pdfjs-boot.js');
  const alt = fs.readFileSync(boot, 'utf8');
  const fresh = alt.replace(/(\/vendor\/pdfjs\/[\w.]+\.mjs\?v=)[\w.-]+/g, `$1${version}`);
  if (fresh !== alt) fs.writeFileSync(boot, fresh);
  return version;
}

module.exports = { copyPdfjs, DATEIEN };

if (require.main === module) {
  const version = copyPdfjs(process.argv[2] ? path.resolve(process.argv[2]) : ROOT);
  console.log(
    version
      ? `[pdfjs] ${version} → public/vendor/pdfjs/`
      : '[pdfjs] pdfjs-dist nicht installiert — die eingecheckten Dateien bleiben',
  );
}
