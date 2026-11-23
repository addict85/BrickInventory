/**
 * A swallowed WRITE operation on user data.
 *
 * Counter-check: `db.run('DELETE FROM sets').catch(() => {})` appended to src/sets/service.ts → red “no silent catch on a write operation with user data”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Tables with data the user entered themselves. */
const USER_DATA = [
  'sets',
  'parts',
  'minifigs',
  'set_acquisitions',
  'part_acquisitions',
  'minifig_acquisitions',
  'users',
  'user_settings',
  'account_links',
];

test('no silent catch on a write operation with user data', () => {
  /** @type {string[]} */
  const files = [];
  const collect = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'coverage', 'public', 'test'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) collect(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  collect(ROOT);
  assert.ok(files.length >= 60, `only ${files.length} files found — the path is wrong`);

  // Why parentheses are matched here instead of just reading a window
  const call = /\b(?:db|tx|dbh|client)\.(?:run|query)\(|\bpool\.query\(/g;
  const stillAfterwards = /^\s*\)?\s*\.catch\(\s*\(?\s*_?\w*\s*\)?\s*=>\s*(\{\s*\}|null|undefined)\s*\)/;
  const write = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${USER_DATA.join('|')})\\b`, 'i');

  const withoutComments = src =>
    src
      .split('\n')
      .map(z => {
        const t = z.trim();
        return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : z;
      })
      .join('\n');

  const violations = [];
  let checked = 0;
  for (const file of files) {
    const src = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const m of src.matchAll(call)) {
      // Up to the closing parenthesis of the call
      let depth = 1,
        i = m.index + m[0].length;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        i++;
      }
      const instruction = src.slice(m.index, i);
      if (!write.test(instruction)) continue;
      checked++;
      if (stillAfterwards.test(src.slice(i, i + 90))) {
        const row = src.slice(0, m.index).split('\n').length;
        violations.push(`${path.relative(ROOT, file)}:${row}`);
      }
    }
  }

  // Self-proof: if the pattern finds no writing calls on these
  // tables, an empty result says nothing.
  assert.ok(checked >= 30, `only ${checked} writing calls on user data found — pattern outdated`);

  assert.deepEqual(
    violations,
    [],
    'These writes to user data fail without a trace:\n  ' +
      violations.join('\n  ') +
      '\nEither pass the error on (no catch at all) or log it with ' +
      'logAndContinue(context).',
  );
});
