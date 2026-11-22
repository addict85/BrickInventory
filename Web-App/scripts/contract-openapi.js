#!/usr/bin/env node
'use strict';

/**
 * Writes docs/openapi-v2.json (API v2) and docs/openapi.json (the v1 alias, unchanged for the
 * app) from the contract in src/contract/. Both are checked in; test/contract-openapi.test.js
 * checks that they match the code. Call: npm run contract:openapi
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATEI = path.join(ROOT, 'docs', 'openapi.json');
const DATEI_V2 = path.join(ROOT, 'docs', 'openapi-v2.json');

/** The text as it should stand in the file. @param {Record<string, unknown>} doc */
const alsText = doc => JSON.stringify(doc, null, 2) + '\n';

if (require.main === module) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
    stdio: 'inherit',
  });
  const { openapi } = require(path.join(ROOT, 'dist', 'src', 'contract', 'openapi.js'));
  /** Only a changed file is written: the Android tree is someone else's and stays on v1. */
  const write = (/** @type {string} */ file, /** @type {string} */ text) => {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
    fs.writeFileSync(file, text);
    console.log(`geschrieben: ${path.relative(ROOT, file)}`);
  };
  write(DATEI, alsText(openapi(1)));
  write(DATEI_V2, alsText(openapi(2)));
  // The UI speaks v2; its types follow in the same step.
  const typen = require('./contract-frontend-types.js');
  write(typen.ZIEL, typen.create(JSON.parse(fs.readFileSync(DATEI_V2, 'utf8'))));
  // The app stays on v1 until it moves itself (UPGRADE.md).
  const kotlin = require('./contract-kotlin-dtos.js');
  write(kotlin.ZIEL, kotlin.create(JSON.parse(fs.readFileSync(DATEI, 'utf8'))));
}

module.exports = { DATEI, DATEI_V2, alsText };
