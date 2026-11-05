#!/usr/bin/env node
/**
 * Lint und Format als Ratsche: Biome (biome.json) findet im Bestand Hunderte
 * Stellen, die erst nach und nach aufgeräumt werden. Rot ist nur, was die
 * Zahl über die Schranke in scripts/lint-schranken.json hebt; sinkt sie, nennt
 * das Skript die neue Zahl zum Nachziehen.
 * Ausführlich: docs/begruendungen/scripts/lint-ratsche.js.md#kopf
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const art = process.argv[2];
if (art !== 'lint' && art !== 'format') {
  console.error('Aufruf: node scripts/lint-ratsche.js lint|format');
  process.exit(2);
}
const schrankenDatei = process.env.LINT_SCHRANKEN || path.join(__dirname, 'lint-schranken.json');
const schranke = JSON.parse(fs.readFileSync(schrankenDatei, 'utf8'))[art];

const biome = path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
const r = spawnSync(process.execPath, [biome, art, '--reporter=json', '--max-diagnostics=none', '.'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});
/** @type {{ diagnostics: { category: string, location?: { path?: string } }[] }} */
let bericht;
try {
  bericht = JSON.parse(r.stdout);
} catch {
  console.error(`[lint] Biome lieferte keinen Bericht (Exit ${r.status}):\n${(r.stderr || r.stdout).slice(-2000)}`);
  process.exit(2);
}

const funde = bericht.diagnostics.filter(d =>
  art === 'lint' ? d.category.startsWith('lint/') : d.category === 'format',
);
const fremd = bericht.diagnostics.filter(d => !d.category.startsWith('lint/') && d.category !== 'format');
if (fremd.length) {
  console.error(
    `[${art}] Biome meldet Fehler ausserhalb der Regeln:\n${fremd.map(d => `${d.category}: ${d.location?.path ?? ''}`).join('\n')}`,
  );
  process.exit(2);
}
const ist = funde.length;
const je = new Map();
for (const d of funde) je.set(d.category, (je.get(d.category) || 0) + 1);
const was = art === 'lint' ? 'Lint-Funde' : 'nicht formatierte Dateien';
if (ist > schranke) {
  console.error(
    `[${art}] ${ist} ${was}, erlaubt sind ${schranke}. Neue Funde mit \`npx biome ${art} <datei>\` ansehen` +
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
  `[${art}] ${ist} ${was} (Schranke ${schranke})${ist < schranke ? ' — Schranke in scripts/lint-schranken.json nachziehen' : ''}`,
);
