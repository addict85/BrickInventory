/**
 * On the phone, number fields bring up the number keyboard.
 *
 * ── Counter-checks (carried out, result in the commit) ──────────────────────────
 *   a) inputmode removed on #add-price     → step 1 red, names the place
 *   b) decimal → numeric on #add-price     → step 2 red
 *   c) #add-price again type="number" (02.11.2026) → step 3 red, names
 *      public/index.html:1719
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** index.html plus all frontend building blocks — NOT the built bundle. */
function sources() {
  const js = fs
    .readdirSync(path.join(ROOT, 'public/js'))
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js')
    .map(f => 'public/js/' + f);
  return ['public/index.html', ...js].map(p => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]);
}

function numberFields() {
  const hits = [];
  for (const [p, s] of sources()) {
    for (const m of s.matchAll(/<input\b[^>]*>/g)) {
      const tag = m[0];
      if (!/type=["']?number|inputmode=["']?decimal/.test(tag)) continue;
      hits.push({ file: p, row: s.slice(0, m.index).split('\n').length, tag });
    }
  }
  return hits;
}

test('1. every type="number" carries an inputmode', () => {
  const fields = numberFields();
  // Self-proof: does the search find anything at all? Without that an
  // empty list would be green forever without ever having looked at a field.
  assert.ok(fields.length >= 20, `Only ${fields.length} number fields found — pattern outdated?`);

  const without = fields.filter(f => !/inputmode=/i.test(f.tag)).map(f => `${f.file}:${f.row}`);
  assert.deepEqual(
    without,
    [],
    'These number fields do not tell the phone which keyboard to show:\n  ' +
      without.join('\n  ') +
      '\n`numeric` for whole numbers, `decimal` for anything with a decimal comma.',
  );
});

test('2. prices and thresholds get `decimal`, not `numeric`', () => {
  // `numeric` is a pure digit pad — without a comma. For a price field
  // that means: one can type 12, but not 12.50. The difference only becomes
  // noticeable when somebody wants to enter an amount with cents.
  const wrong = [];
  for (const f of numberFields()) {
    const commaField = /step=["']?0?\.\d/.test(f.tag);
    const mode = (f.tag.match(/inputmode=["']?(\w+)/i) || [])[1];
    if (commaField && mode !== 'decimal') wrong.push(`${f.file}:${f.row} (${mode})`);
  }
  assert.deepEqual(
    wrong,
    [],
    'These fields allow decimals (step=0.01) but show a pure ' + 'digit pad:\n  ' + wrong.join('\n  '),
  );
});

test('3. money fields are text fields: type="number" discards "149,95"', () => {
  // Depending on the language, Chrome delivers "" or 149 for a number field with a comma;
  // it is read with readAmount() (money-input.test.js checks the behavior).
  const wrong = numberFields()
    .filter(f => /inputmode=["']?decimal/i.test(f.tag) && /type=["']?number/.test(f.tag))
    .map(f => `${f.file}:${f.row}`);
  assert.deepEqual(wrong, []);
});
