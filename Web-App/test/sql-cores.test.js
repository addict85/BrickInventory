/**
 * No SQL statement stands in more than one file.
 *
 * Counter-check (carried out): one of the merged statements copied back into a
 * second file -> red, with both locations.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Statements that may deliberately stand more than once — each with the reason.
 * Empty: there are none at the moment.
 */
const ALLOWED = new Map([]);

test('no SQL statement is in more than one file', () => {
  // Found, not enumerated.
  const dateien = [];
  const gehen = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'scripts', 'public', '.git'].includes(e.name) || e.name.startsWith('.'))
        continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  gehen(ROOT);
  assert.ok(dateien.length >= 60, `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  // Fetch statements from strings, unify whitespace. A
  // route key of the API contract ('DELETE /api/v1/…') is not SQL.
  const sql = /(['"`])((?:SELECT|INSERT|UPDATE|DELETE)\s(?!\/)[\s\S]*?)\1/g;
  const wo = new Map();
  let gefunden = 0;
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    for (const m of code.matchAll(sql)) {
      const k = m[2].replace(/\s+/g, ' ').trim();
      // Too short to mean anything of its own (`SELECT 1 FROM x WHERE id=$1`).
      if (k.length < 45) continue;
      gefunden++;
      if (!wo.has(k)) wo.set(k, new Set());
      wo.get(k).add(rel);
    }
  }
  // Self-proof: if the search found hardly any statements, the rule would be vacuously true.
  assert.ok(gefunden >= 300, `Nur ${gefunden} SQL-Anweisungen gefunden — die Suche greift nicht mehr`);

  const doppelt = [];
  const gebraucht = new Set();
  for (const [k, orte] of wo) {
    if (orte.size < 2) continue;
    // Book instead of skip — otherwise it never stands out when an entry
    // becomes moot. The list is empty today; the check stands
    // here nevertheless, so that the first entry already finds it.
    if (ALLOWED.has(k)) {
      gebraucht.add(k);
      continue;
    }
    doppelt.push(`${[...orte].sort().join(' + ')}\n      ${k.slice(0, 130)}`);
  }
  const veraltet = [...ALLOWED.keys()].filter(k => !gebraucht.has(k));
  assert.deepEqual(
    veraltet,
    [],
    'Diese Eintraege in ALLOWED beschreiben keine Doppelung mehr — raus damit:\n  ' +
      veraltet.map(k => k.slice(0, 130)).join('\n  '),
  );
  assert.deepEqual(
    doppelt,
    [],
    'Diese Anweisungen stehen in mehreren Dateien. Entweder gehoeren sie in ' +
      'eine gemeinsame Funktion, oder es gibt einen Grund — dann in ALLOWED ' +
      'eintragen, damit der Naechste ihn nicht neu herleiten muss',
  );
});
