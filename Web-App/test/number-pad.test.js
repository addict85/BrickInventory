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
function quellen() {
  const js = fs
    .readdirSync(path.join(ROOT, 'public/js'))
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js')
    .map(f => 'public/js/' + f);
  return ['public/index.html', ...js].map(p => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]);
}

function numberFields() {
  const treffer = [];
  for (const [p, s] of quellen()) {
    for (const m of s.matchAll(/<input\b[^>]*>/g)) {
      const tag = m[0];
      if (!/type=["']?number|inputmode=["']?decimal/.test(tag)) continue;
      treffer.push({ datei: p, zeile: s.slice(0, m.index).split('\n').length, tag });
    }
  }
  return treffer;
}

test('1. every type="number" carries an inputmode', () => {
  const felder = numberFields();
  // Self-proof: does the search find anything at all? Without that an
  // empty list would be green forever without ever having looked at a field.
  assert.ok(felder.length >= 20, `Nur ${felder.length} Zahlenfelder gefunden — Muster veraltet?`);

  const ohne = felder.filter(f => !/inputmode=/i.test(f.tag)).map(f => `${f.datei}:${f.zeile}`);
  assert.deepEqual(
    ohne,
    [],
    'Diese Zahlenfelder sagen dem Handy nicht, welche Tastatur es zeigen soll:\n  ' +
      ohne.join('\n  ') +
      '\n`numeric` für ganze Zahlen, `decimal` für alles mit Komma.',
  );
});

test('2. prices and thresholds get `decimal`, not `numeric`', () => {
  // `numeric` is a pure digit pad — without a comma. For a price field
  // that means: one can type 12, but not 12.50. The difference only becomes
  // noticeable when somebody wants to enter an amount with cents.
  const falsch = [];
  for (const f of numberFields()) {
    const commaField = /step=["']?0?\.\d/.test(f.tag);
    const modus = (f.tag.match(/inputmode=["']?(\w+)/i) || [])[1];
    if (commaField && modus !== 'decimal') falsch.push(`${f.datei}:${f.zeile} (${modus})`);
  }
  assert.deepEqual(
    falsch,
    [],
    'Diese Felder erlauben Kommastellen (step=0.01), zeigen aber einen reinen ' +
      'Ziffernblock:\n  ' +
      falsch.join('\n  '),
  );
});

test('3. money fields are text fields: type="number" discards "149,95"', () => {
  // Depending on the language, Chrome delivers "" or 149 for a number field with a comma;
  // it is read with readAmount() (money-input.test.js checks the behavior).
  const falsch = numberFields()
    .filter(f => /inputmode=["']?decimal/i.test(f.tag) && /type=["']?number/.test(f.tag))
    .map(f => `${f.datei}:${f.zeile}`);
  assert.deepEqual(falsch, []);
});
