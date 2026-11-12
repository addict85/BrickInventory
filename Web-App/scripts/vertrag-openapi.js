#!/usr/bin/env node
'use strict';

/**
 * Schreibt docs/openapi.json aus dem Vertrag in src/vertrag/.
 * Die Datei ist eingecheckt; test/vertrag-openapi.test.js prüft, dass sie
 * zum Code passt. Aufruf: npm run vertrag:openapi
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATEI = path.join(ROOT, 'docs', 'openapi.json');

/** Der Text, wie er in der Datei stehen soll. @param {Record<string, unknown>} dok */
const alsText = dok => JSON.stringify(dok, null, 2) + '\n';

if (require.main === module) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
    stdio: 'inherit',
  });
  const { openapi } = require(path.join(ROOT, 'dist', 'src', 'vertrag', 'openapi.js'));
  fs.writeFileSync(DATEI, alsText(openapi()));
  console.log(`geschrieben: ${path.relative(ROOT, DATEI)}`);
  // Die Typen der Oberfläche folgen dem Vertrag im selben Schritt.
  const typen = require('./vertrag-frontend-typen.js');
  fs.writeFileSync(typen.ZIEL, typen.erzeuge(JSON.parse(fs.readFileSync(DATEI, 'utf8'))));
  console.log(`geschrieben: ${path.relative(ROOT, typen.ZIEL)}`);
}

module.exports = { DATEI, alsText };
