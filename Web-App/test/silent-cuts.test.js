/**
 * No test excerpt on which ONLY negating assertions stand may be
 * cut unsecured.
 *
 * Counter-check: a snippet checked only with doesNotMatch appended to a test file → red “no snippet with only negative assertions is unsecured”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Assertions that stay green on an EMPTY excerpt. */
const NEGATING = new Set(['doesNotMatch', 'doesNotThrow', 'notMatch']);

test('no snippet with only negative assertions is unsecured', () => {
  const files = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort();
  assert.ok(files.length > 100, `Only ${files.length} test files — folder renamed?`);

  const still = [];
  let checked = 0;

  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(\w+)\.slice\(\s*\2\.indexOf\(/g)) {
      const target = m[1];
      checked++;

      // The surrounding test block, roughly: up to the next "\n});"
      let block = src.slice(m.index + m[0].length, m.index + m[0].length + 3000);
      const end = block.indexOf('\n});');
      if (end > 0) block = block.slice(0, end);

      // Which assertions run on this excerpt?
      const kinds = [...block.matchAll(new RegExp(`assert\\.(\\w+)\\(\\s*${target}\\b`, 'g'))].map(a => a[1]);
      if (!kinds.length) continue; // is only passed on
      if (kinds.some(a => !NEGATING.has(a))) continue; // a positive one suffices

      // Secured after all?
      const derived = new RegExp(`(\\w+)\\s*=\\s*${target}\\.indexOf\\(`, 'g');
      const indexes = [...block.matchAll(derived)].map(a => a[1]);
      if (indexes.some(n => new RegExp(`assert\\.ok\\([^)]*\\b${n}\\b\\s*[><!=]`).test(block))) continue;

      still.push(`${file}:${src.slice(0, m.index).split('\n').length}  (${[...new Set(kinds)].join(', ')})`);
    }
  }

  // Self-proof: if the search finds no cuts, the assertion below would be
  // silently green — the same kind of error this test is built
  // against. MEASURED there are 41 (22.11.2026: the behavior checks on source text are gone, 102 before).
  assert.ok(checked > 30, `Only ${checked} cuts found (measured: 41) — the search pattern is outdated.`);

  assert.deepEqual(
    still,
    [],
    'These excerpts carry ONLY negative assertions, and the cut ' +
      'is unguarded. If the anchor text points into nothing one day, the test stays ' +
      'green and checks nothing any more. Please use section() from test/helpers/sources.js ' +
      '— it throws when the anchor is missing.',
  );
});
