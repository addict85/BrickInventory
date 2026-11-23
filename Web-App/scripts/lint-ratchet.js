#!/usr/bin/env node
/**
 * Lint and format as a ratchet: Biome (biome.json) finds hundreds of places in the
 * existing code that are only cleaned up bit by bit. Red is only what raises the
 * number above the limit in scripts/lint-limits.json; if it drops, the
 * script names the new number to update.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const kind = process.argv[2];
if (kind !== 'lint' && kind !== 'format') {
  console.error('Aufruf: node scripts/lint-ratchet.js lint|format');
  process.exit(2);
}
const limitsFile = process.env.LINT_LIMITS || path.join(__dirname, 'lint-limits.json');
const limit = JSON.parse(fs.readFileSync(limitsFile, 'utf8'))[kind];

const biome = path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
// LINT_ROOT: another tree with its own biome.json, for the test with deliberate findings.
const r = spawnSync(process.execPath, [biome, kind, '--reporter=json', '--max-diagnostics=none', '.'], {
  cwd: process.env.LINT_ROOT || ROOT,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});
/** @type {{ diagnostics: { category: string, location?: { path?: string } }[] }} */
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error(`[lint] Biome lieferte keinen Bericht (Exit ${r.status}):\n${(r.stderr || r.stdout).slice(-2000)}`);
  process.exit(2);
}

// Own rules (biome/*.grit) report as "plugin"; they count like any other lint rule.
const isLint = (/** @type {{ category: string }} */ d) => d.category.startsWith('lint/') || d.category === 'plugin';
const findings = report.diagnostics.filter(d => (kind === 'lint' ? isLint(d) : d.category === 'format'));
const fremd = report.diagnostics.filter(d => !isLint(d) && d.category !== 'format');
if (fremd.length) {
  console.error(
    `[${kind}] Biome meldet Fehler ausserhalb der Regeln:\n${fremd.map(d => `${d.category}: ${d.location?.path ?? ''}`).join('\n')}`,
  );
  process.exit(2);
}
const actual = findings.length;
const byKind = new Map();
for (const d of findings) byKind.set(d.category, (byKind.get(d.category) || 0) + 1);
const was = kind === 'lint' ? 'Lint-Funde' : 'nicht formatierte Dateien';
if (actual > limit) {
  console.error(
    `[${kind}] ${actual} ${was}, erlaubt sind ${limit}. Neue Funde mit \`npx biome ${kind} <datei>\` ansehen` +
      (kind === 'format' ? ' und mit `npx biome format --write <datei>` beheben.' : '.'),
  );
  if (kind === 'lint')
    console.error(
      [...byKind]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, n]) => `  ${n}\t${k}`)
        .join('\n'),
    );
  process.exit(1);
}
console.log(
  `[${kind}] ${actual} ${was} (Schranke ${limit})${actual < limit ? ' — Schranke in scripts/lint-limits.json nachziehen' : ''}`,
);
