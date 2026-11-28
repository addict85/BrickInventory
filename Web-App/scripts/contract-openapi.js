#!/usr/bin/env node
'use strict';

/**
 * Writes docs/openapi-v2.json (API v2) and docs/openapi.json (the v1 alias, kept for app
 * versions before the move to v2) from the contract in src/contract/. Both are checked in; test/contract-openapi.test.js
 * checks that they match the code. Call: npm run contract:openapi
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'docs', 'openapi.json');
const OUT_FILE_V2 = path.join(ROOT, 'docs', 'openapi-v2.json');

/** The text as it should stand in the file. @param {Record<string, unknown>} doc */
const asText = doc => JSON.stringify(doc, null, 2) + '\n';

if (require.main === module) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
    stdio: 'inherit',
  });
  const { openapi } = require(path.join(ROOT, 'dist', 'src', 'contract', 'openapi.js'));
  /** Only a changed file is written: an unchanged run leaves the tree untouched. */
  const write = (/** @type {string} */ file, /** @type {string} */ text) => {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
    fs.writeFileSync(file, text);
    console.log(`geschrieben: ${path.relative(ROOT, file)}`);
  };
  write(OUT_FILE, asText(openapi(1)));
  write(OUT_FILE_V2, asText(openapi(2)));
  // The UI speaks v2; its types follow in the same step.
  const types = require('./contract-frontend-types.js');
  write(types.TARGET_FILE, types.create(JSON.parse(fs.readFileSync(OUT_FILE_V2, 'utf8'))));
  // The app speaks v2 as well; the v1 document stays for older app versions until the sunset.
  const kotlin = require('./contract-kotlin-dtos.js');
  kotlin.write(kotlin.files(JSON.parse(fs.readFileSync(OUT_FILE_V2, 'utf8'))));
}

module.exports = { OUT_FILE, OUT_FILE_V2, asText };
