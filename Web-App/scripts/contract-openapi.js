#!/usr/bin/env node
'use strict';

/**
 * Writes docs/openapi.json from the contract in src/contract/.
 * The file is checked in; test/contract-openapi.test.js checks that it
 * matches the code. Call: npm run contract:openapi
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATEI = path.join(ROOT, 'docs', 'openapi.json');

/** The text as it should stand in the file. @param {Record<string, unknown>} doc */
const alsText = doc => JSON.stringify(doc, null, 2) + '\n';

if (require.main === module) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
    stdio: 'inherit',
  });
  const { openapi } = require(path.join(ROOT, 'dist', 'src', 'contract', 'openapi.js'));
  fs.writeFileSync(DATEI, alsText(openapi()));
  console.log(`geschrieben: ${path.relative(ROOT, DATEI)}`);
  // The UI's types follow the contract in the same step.
  const typen = require('./contract-frontend-types.js');
  fs.writeFileSync(typen.ZIEL, typen.create(JSON.parse(fs.readFileSync(DATEI, 'utf8'))));
  console.log(`geschrieben: ${path.relative(ROOT, typen.ZIEL)}`);
  // Likewise the response types of the Android app (core-contract).
  const kotlin = require('./contract-kotlin-dtos.js');
  fs.writeFileSync(kotlin.ZIEL, kotlin.create(JSON.parse(fs.readFileSync(DATEI, 'utf8'))));
  console.log(`geschrieben: ${path.relative(ROOT, kotlin.ZIEL)}`);
}

module.exports = { DATEI, alsText };
