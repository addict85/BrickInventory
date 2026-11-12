#!/usr/bin/env node
'use strict';

/**
 * PDF.js kommt aus der npm-Abhängigkeit pdfjs-dist (exakte Fassung in
 * package.json), damit npm audit und Renovate es sehen. Dieses Skript legt die
 * beiden Dateien nach public/vendor/pdfjs/ und zieht die Fassung im
 * Cache-Brecher von public/js/pdfjs-boot.js nach; build-frontend.js ruft es.
 *
 *   node scripts/pdfjs-kopieren.js [Zielwurzel]
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATEIEN = ['pdf.min.mjs', 'pdf.worker.min.mjs'];

/** @returns die kopierte Fassung, oder null ohne installiertes pdfjs-dist */
function kopierePdfjs(ziel = ROOT, quelle = ROOT) {
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

module.exports = { kopierePdfjs, DATEIEN };

if (require.main === module) {
  const fassung = kopierePdfjs(process.argv[2] ? path.resolve(process.argv[2]) : ROOT);
  console.log(
    fassung
      ? `[pdfjs] ${fassung} → public/vendor/pdfjs/`
      : '[pdfjs] pdfjs-dist nicht installiert — die eingecheckten Dateien bleiben',
  );
}
