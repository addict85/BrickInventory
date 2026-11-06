#!/usr/bin/env node
'use strict';
/**
 * Typprüfung der Oberfläche: tsc über tsconfig.frontend.json (ES-Module) und
 * tsconfig.frontend-skripte.json (die zwei klassischen Skripte). Beide müssen
 * 0 Meldungen haben. `--json` gibt die Meldungen je Lauf maschinenlesbar aus
 * (für test/browser-namen.test.js).
 *
 *   npm run typecheck:frontend
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TSC = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const LAEUFE = ['tsconfig.frontend.json', 'tsconfig.frontend-skripte.json'];

/** @param {string} config @param {string[]} [extra] @returns {string[]} die Meldungen */
function pruefe(config, extra = []) {
  const r = spawnSync(TSC, ['-p', path.join(ROOT, config), ...extra], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === null) throw new Error(`tsc lief nicht: ${r.error?.message}`);
  const meldungen = (r.stdout + r.stderr).split('\n').filter(z => /error TS\d+:/.test(z));
  if (r.status !== 0 && !meldungen.length) throw new Error(`tsc scheiterte ohne Meldung:\n${r.stdout}${r.stderr}`);
  return meldungen;
}

if (require.main === module) {
  let summe = 0;
  /** @type {Record<string, string[]>} */
  const ergebnis = {};
  for (const c of LAEUFE) {
    const m = pruefe(c);
    ergebnis[c] = m;
    summe += m.length;
    if (!process.argv.includes('--json')) {
      for (const z of m) console.error(z);
      console.log(`[typecheck:frontend] ${c}: ${m.length} Meldungen`);
    }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(ergebnis));
  process.exit(summe ? 1 : 0);
}

module.exports = { pruefe, LAEUFE };
