#!/usr/bin/env node
/**
 * Lint and format as a ratchet: Biome (biome.json) finds hundreds of places in the
 * existing code that are only cleaned up bit by bit. Red is only what raises the
 * number above the limit in scripts/lint-schranken.json; if it drops, the
 * script names the new number to update.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const art = process.argv[2];
if (art !== 'lint' && art !== 'format') {
  console.error('Aufruf: node scripts/lint-ratchet.js lint|format');
  process.exit(2);
}
const limitsFile = process.env.LINT_SCHRANKEN || path.join(__dirname, 'lint-schranken.json');
const limit = JSON.parse(fs.readFileSync(limitsFile, 'utf8'))[art];

const biome = path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
// LINT_WURZEL: another tree with its own biome.json, for the test with deliberate findings.
const r = spawnSync(process.execPath, [biome, art, '--reporter=json', '--max-diagnostics=none', '.'], {
  cwd: process.env.LINT_WURZEL || ROOT,
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
const findings = report.diagnostics.filter(d => (art === 'lint' ? isLint(d) : d.category === 'format'));
const fremd = report.diagnostics.filter(d => !isLint(d) && d.category !== 'format');
if (fremd.length) {
  console.error(
    `[${art}] Biome meldet Fehler ausserhalb der Regeln:\n${fremd.map(d => `${d.category}: ${d.location?.path ?? ''}`).join('\n')}`,
  );
  process.exit(2);
}
const actual = findings.length;
const je = new Map();
for (const d of findings) je.set(d.category, (je.get(d.category) || 0) + 1);
const was = art === 'lint' ? 'Lint-Funde' : 'nicht formatierte Dateien';
if (actual > limit) {
  console.error(
    `[${art}] ${actual} ${was}, erlaubt sind ${limit}. Neue Funde mit \`npx biome ${art} <datei>\` ansehen` +
      (art === 'format' ? ' und mit `npx biome format --write <datei>` beheben.' : '.'),
  );
  if (art === 'lint')
    console.error(
      [...je]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, n]) => `  ${n}\t${k}`)
        .join('\n'),
    );
  process.exit(1);
}
console.log(
  `[${art}] ${actual} ${was} (Schranke ${limit})${actual < limit ? ' — Schranke in scripts/lint-schranken.json nachziehen' : ''}`,
);
