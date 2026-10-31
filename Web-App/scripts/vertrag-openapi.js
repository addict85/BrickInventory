#!/usr/bin/env node
'use strict';
/**
 * Schreibt docs/openapi.json aus dem Vertrag in src/infra/vertrag/.
 * Die Datei ist eingecheckt; test/vertrag-openapi.test.js prüft, dass sie
 * zum Code passt. Aufruf: npm run vertrag:openapi
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATEI = path.join(ROOT, 'docs', 'openapi.json');

/** Der Text, wie er in der Datei stehen soll. @param {Record<string, unknown>} dok */
const alsText = (dok) => JSON.stringify(dok, null, 2) + '\n';

if (require.main === module) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')],
    { stdio: 'inherit' });
  const { openapi } = require(path.join(ROOT, 'dist', 'src', 'infra', 'vertrag', 'openapi.js'));
  fs.writeFileSync(DATEI, alsText(openapi()));
  console.log(`geschrieben: ${path.relative(ROOT, DATEI)}`);
}

module.exports = { DATEI, alsText };
