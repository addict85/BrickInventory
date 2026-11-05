#!/usr/bin/env node
/**
 * Typprüfung der Tests (tsconfig.test.json, checkJs ohne strict) als Ratsche:
 * rot erst, wenn die Zahl der Meldungen über "testtypen" in
 * scripts/lint-schranken.json steigt. LINT_SCHRANKEN=<datei> für den Test.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const schranke = JSON.parse(
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
if (meldungen.length > schranke) {
  console.error(meldungen.slice(0, 30).join('\n'));
  console.error(`[typecheck:tests] ${meldungen.length} Meldungen, erlaubt sind ${schranke}`);
  process.exit(1);
}
console.log(
  `[typecheck:tests] ${meldungen.length} Meldungen (Schranke ${schranke})${meldungen.length < schranke ? ' — Schranke nachziehen' : ''}`,
);
