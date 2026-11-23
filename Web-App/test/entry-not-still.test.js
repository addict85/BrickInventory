/**
 * A lost entry does not disappear silently.
 *
 * Counter-check: `.catch(() => {})` after addPurchaseAtTag in src/inventory/reassign.ts → red “no silent catch on an acquisition”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('no silent catch on an acquisition', () => {
  const ROOT = path.join(__dirname, '..');
  const dir = ['routes', 'src', 'jobs'];

  /** @type {string[]} */
  const files = [];
  const collect = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) collect(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  for (const o of dir) {
    const p = path.join(ROOT, o);
    assert.ok(fs.existsSync(p), `${o}/ does not exist — without the folder this test checks nothing`);
    collect(p);
  }
  assert.ok(files.length >= 30, `only ${files.length} files found — the path is wrong`);

  const violations = [];
  let calls = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // Internally the booking is called addPurchaseAtTag, in the service set bookDailyEntry.
    for (const m of src.matchAll(/\b(?:addPurchaseAtTag|bookDailyEntry)\(/g)) {
      const i = m.index ?? 0;
      if (!/\bfunction\s+addPurchaseAtTag/.test(src.slice(Math.max(0, i - 40), i + 24))) {
        calls++;
        // The window after the call: up to the end of the statement.
        const win = src.slice(i, i + 400);
        if (/\)\s*\.catch\(\s*\(\s*_?\s*\)\s*=>\s*\{\s*\}\s*\)/.test(win)) {
          const row = src.slice(0, i).split('\n').length;
          violations.push(`${path.relative(ROOT, file)}:${row}`);
        }
      }
    }
  }

  // Self-proof: if the pattern finds no calls, an empty result says
  // nothing. There are clearly more than five of them.
  assert.ok(calls >= 5, `only ${calls} call(s) of addPurchaseAtTag found — pattern outdated?`);

  assert.deepEqual(
    violations,
    [],
    'These acquisitions disappear without a trace on an error:\n  ' +
      violations.join('\n  ') +
      '\nEither pass the error on (no catch at all) or log it with ' +
      'logAndContinue(context).',
  );
});
