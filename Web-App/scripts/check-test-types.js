#!/usr/bin/env node
/**
 * Type check of the tests (tsconfig.test.json, checkJs without strict) as a ratchet:
 * red only when the number of messages rises above "testtypen" in
 * scripts/lint-schranken.json. LINT_SCHRANKEN=<file> for the test.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const limit = JSON.parse(
  fs.readFileSync(process.env.LINT_SCHRANKEN || path.join(__dirname, 'lint-schranken.json'), 'utf8'),
).testtypen;
const r = spawnSync(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.test.json'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const meldungen = `${r.stdout}${r.stderr}`.split('\n').filter(z => /error TS\d+:/.test(z));
if (r.status !== 0 && !meldungen.length) {
  console.error(`[typecheck:tests] tsc scheiterte ohne Meldung:\n${r.stdout}${r.stderr}`);
  process.exit(2);
}
if (meldungen.some(z => /^tsconfig\.test\.json/.test(z))) {
  console.error(`[typecheck:tests] Konfiguration fehlerhaft:\n${meldungen.join('\n')}`);
  process.exit(2);
}
if (meldungen.length > limit) {
  console.error(meldungen.slice(0, 30).join('\n'));
  console.error(`[typecheck:tests] ${meldungen.length} Meldungen, erlaubt sind ${limit}`);
  process.exit(1);
}
console.log(
  `[typecheck:tests] ${meldungen.length} Meldungen (Schranke ${limit})${meldungen.length < limit ? ' — Schranke nachziehen' : ''}`,
);
