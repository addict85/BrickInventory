#!/usr/bin/env node
/**
 * Type check of the tests (tsconfig.test.json, checkJs without strict) as a ratchet:
 * red only when the number of messages rises above "testTypes" in
 * scripts/lint-limits.json. LINT_LIMITS=<file> for the test.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const limit = JSON.parse(
  fs.readFileSync(process.env.LINT_LIMITS || path.join(__dirname, 'lint-limits.json'), 'utf8'),
).testTypes;
const r = spawnSync(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.test.json'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const messages = `${r.stdout}${r.stderr}`.split('\n').filter(z => /error TS\d+:/.test(z));
if (r.status !== 0 && !messages.length) {
  console.error(`[typecheck:tests] tsc scheiterte ohne Meldung:\n${r.stdout}${r.stderr}`);
  process.exit(2);
}
if (messages.some(z => /^tsconfig\.test\.json/.test(z))) {
  console.error(`[typecheck:tests] Konfiguration fehlerhaft:\n${messages.join('\n')}`);
  process.exit(2);
}
if (messages.length > limit) {
  console.error(messages.slice(0, 30).join('\n'));
  console.error(`[typecheck:tests] ${messages.length} Meldungen, erlaubt sind ${limit}`);
  process.exit(1);
}
console.log(
  `[typecheck:tests] ${messages.length} Meldungen (Schranke ${limit})${messages.length < limit ? ' — Schranke nachziehen' : ''}`,
);
