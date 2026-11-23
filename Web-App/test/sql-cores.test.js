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
  const files = [];
  const go = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'scripts', 'public', '.git'].includes(e.name) || e.name.startsWith('.'))
        continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) go(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(abs);
    }
  };
  go(ROOT);
  assert.ok(files.length >= 60, `Only ${files.length} source files found — the search no longer works`);

  // Fetch statements from strings, unify whitespace. A
  // route key of the API contract ('DELETE /api/v2/…') is not SQL.
  const sql = /(['"`])((?:SELECT|INSERT|UPDATE|DELETE)\s(?!\/)[\s\S]*?)\1/g;
  const where = new Map();
  let found = 0;
  for (const f of files) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    for (const m of code.matchAll(sql)) {
      const k = m[2].replace(/\s+/g, ' ').trim();
      // Too short to mean anything of its own (`SELECT 1 FROM x WHERE id=$1`).
      if (k.length < 45) continue;
      found++;
      if (!where.has(k)) where.set(k, new Set());
      where.get(k).add(rel);
    }
  }
  // Self-proof: if the search found hardly any statements, the rule would be vacuously true.
  assert.ok(found >= 300, `Only ${found} SQL statements found — the search no longer works`);

  const twice = [];
  const used = new Set();
  for (const [k, locations] of where) {
    if (locations.size < 2) continue;
    // Book instead of skip — otherwise it never stands out when an entry
    // becomes moot. The list is empty today; the check stands
    // here nevertheless, so that the first entry already finds it.
    if (ALLOWED.has(k)) {
      used.add(k);
      continue;
    }
    twice.push(`${[...locations].sort().join(' + ')}\n      ${k.slice(0, 130)}`);
  }
  const stale = [...ALLOWED.keys()].filter(k => !used.has(k));
  assert.deepEqual(
    stale,
    [],
    'These entries in ALLOWED no longer describe a duplicate — remove them:\n  ' +
      stale.map(k => k.slice(0, 130)).join('\n  '),
  );
  assert.deepEqual(
    twice,
    [],
    'These statements are in several files. Either they belong in ' +
      'a shared function, or there is a reason — then add it to ALLOWED ' +
      'so that the next person does not have to work it out again',
  );
});
