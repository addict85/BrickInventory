#!/usr/bin/env node
'use strict';

/**
 * Type check of the UI: tsc over tsconfig.frontend.json (ES modules) and
 * tsconfig.frontend-scripts.json (the two classic scripts). Both must
 * have 0 messages. `--json` outputs the messages per run machine-readably
 * (for test/browser-names.test.js).
 *
 *   npm run typecheck:frontend
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TSC = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const RUNS = ['tsconfig.frontend.json', 'tsconfig.frontend-scripts.json'];

/** @param {string} config @param {string[]} [extra] @returns {string[]} the messages */
function check(config, extra = []) {
  const r = spawnSync(TSC, ['-p', path.join(ROOT, config), ...extra], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === null) throw new Error(`tsc lief nicht: ${r.error?.message}`);
  const messages = (r.stdout + r.stderr).split('\n').filter(z => /error TS\d+:/.test(z));
  if (r.status !== 0 && !messages.length) throw new Error(`tsc scheiterte ohne Meldung:\n${r.stdout}${r.stderr}`);
  return messages;
}

if (require.main === module) {
  let sum = 0;
  /** @type {Record<string, string[]>} */
  const result = {};
  for (const c of RUNS) {
    const m = check(c);
    result[c] = m;
    sum += m.length;
    if (!process.argv.includes('--json')) {
      for (const z of m) console.error(z);
      console.log(`[typecheck:frontend] ${c}: ${m.length} Meldungen`);
    }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(result));
  process.exit(sum ? 1 : 0);
}

module.exports = { check, RUNS };
