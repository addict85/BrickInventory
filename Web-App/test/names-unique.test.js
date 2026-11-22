/**
 * A function name means one thing.
 *
 * Counter-check (carried out): a name removed from ALLOWED -> red; the
 * settings version named effectiveCondition again -> red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Name -> why it may occur more than once. */
const ALLOWED = new Map([
  [
    'run',
    'db/database und drei Jobs: „ausfuehren". In den Jobs ist es der Einstieg, ' +
      'in der Datenbank die Anweisung — gleicher Begriff, kein gemeinsamer Gegenstand.',
  ],
  ['log', 'drei Jobs, jeder schreibt mit seinem eigenen Praefix.'],
  [
    'setDetails',
    'clients/brickset und src/catalog/rebrickableCatalog — dieselbe Frage an ZWEI ' +
      'verschiedene Dienste. Der Dateiname sagt, welcher gemeint ist.',
  ],
  [
    'httpsGet',
    'clients/bricklink und clients/brickset — jeder mit der Signatur seines ' +
      'Dienstes (BrickLink braucht einen Authorization-Kopf, Brickset nicht).',
  ],
  ['writeBuffer', 'src/images/imageDemandRun und src/images/imageMisses — jeder schreibt SEINEN Puffer.'],
]);

test('a function name means one thing', () => {
  const dateien = [];
  const go = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'scripts', 'public', '.git'].includes(e.name) || e.name.startsWith('.'))
        continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) go(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  go(ROOT);
  assert.ok(dateien.length >= 60, `Only ${dateien.length} source files found — the search no longer works`);

  const wo = new Map();
  let found = 0;
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    // Generic functions too (`function all<T = any>(`).
    for (const m of code.matchAll(/^(?:export )?(?:async )?function (\w+)(?:<[^>(]*>)?\(/gm)) {
      found++;
      if (!wo.has(m[1])) wo.set(m[1], new Set());
      wo.get(m[1]).add(rel);
    }
  }
  // Self-proof: if the search found hardly any functions, the rule would be vacuously true.
  assert.ok(found >= 300, `Only ${found} functions found — the search no longer works`);

  const doppelt = [];
  const gebraucht = new Set();
  for (const [name, locations] of wo) {
    if (locations.size < 2) continue;
    // An allowed name is not skipped but BOOKED: only that way it
    // becomes noticeable when it has long stood in only one place and the
    // entry describes nothing any more. A dead entry looks like a
    // decision and yet is merely a guess as soon as nobody checks.
    if (ALLOWED.has(name)) {
      gebraucht.add(name);
      continue;
    }
    doppelt.push(`${name}: ${[...locations].sort().join(', ')}`);
  }
  const veraltet = [...ALLOWED.keys()].filter(k => !gebraucht.has(k)).sort();
  assert.deepEqual(
    veraltet,
    [],
    'These entries in ALLOWED no longer describe a duplicate:\n  ' +
      veraltet.join('\n  ') +
      '\nThe name is only in one place now — remove it.',
  );
  assert.deepEqual(
    doppelt.sort(),
    [],
    'These names are in several files. Either they mean the same thing — then ' +
      'they belong in a shared function —, or they mean DIFFERENT things, ' +
      'then one needs a different name. If neither is the case, add it to ALLOWED ' +
      'with the reason',
  );
});
