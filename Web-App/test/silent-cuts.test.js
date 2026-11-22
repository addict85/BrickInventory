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
  const dateien = fs
    .readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort();
  assert.ok(dateien.length > 100, `Only ${dateien.length} test files — folder renamed?`);

  const still = [];
  let geprueft = 0;

  for (const datei of dateien) {
    const src = fs.readFileSync(path.join(__dirname, datei), 'utf8');
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(\w+)\.slice\(\s*\2\.indexOf\(/g)) {
      const ziel = m[1];
      geprueft++;

      // The surrounding test block, roughly: up to the next "\n});"
      let block = src.slice(m.index + m[0].length, m.index + m[0].length + 3000);
      const ende = block.indexOf('\n});');
      if (ende > 0) block = block.slice(0, ende);

      // Which assertions run on this excerpt?
      const arten = [...block.matchAll(new RegExp(`assert\\.(\\w+)\\(\\s*${ziel}\\b`, 'g'))].map(a => a[1]);
      if (!arten.length) continue; // is only passed on
      if (arten.some(a => !NEGATING.has(a))) continue; // a positive one suffices

      // Secured after all?
      const derived = new RegExp(`(\\w+)\\s*=\\s*${ziel}\\.indexOf\\(`, 'g');
      const indizes = [...block.matchAll(derived)].map(a => a[1]);
      if (indizes.some(n => new RegExp(`assert\\.ok\\([^)]*\\b${n}\\b\\s*[><!=]`).test(block))) continue;

      still.push(`${datei}:${src.slice(0, m.index).split('\n').length}  (${[...new Set(arten)].join(', ')})`);
    }
  }

  // Self-proof: if the search finds no cuts, the assertion below would be
  // silently green — the same kind of error this test is built
  // against. MEASURED there are 102.
  assert.ok(geprueft > 50, `Only ${geprueft} cuts found (measured: 102) — the search pattern is outdated.`);

  assert.deepEqual(
    still,
    [],
    'These excerpts carry ONLY negative assertions, and the cut ' +
      'is unguarded. If the anchor text points into nothing one day, the test stays ' +
      'green and checks nothing any more. Please use abschnitt() from test/helpers/sources.js ' +
      '— it throws when the anchor is missing.',
  );
});
