/**
 * No fixed text in a place that the user reads.
 *
 * Counter-check: a fixed German text assigned to textContent in public/js/catalog.js → red “no fixed text in textContent, placeholder, title, toast, confirm or alert”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const LOWER = [
  /\.(?:textContent|placeholder|title)\s*=\s*'([^']{2,})'/g,
  /\.(?:textContent|placeholder|title)\s*=\s*"([^"]{2,})"/g,
  /\btoast\(\s*'([^']{2,})'/g,
  /\btoast\(\s*"([^"]{2,})"/g,
  /\bconfirm\(\s*'([^']{2,})'/g,
  /\balert\(\s*'([^']{2,})'/g,
];

test('no fixed text in textContent, placeholder, title, toast, confirm or alert', () => {
  const dateien = [];
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/node_modules|locales/.test(p)) lauf(p);
        continue;
      }
      if (!e.name.endsWith('.js') || e.name === 'app.bundle.js') continue;
      dateien.push([
        path.relative(ROOT, p),
        fs
          .readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      ]);
    }
  };
  lauf(path.join(ROOT, 'public'));
  assert.ok(dateien.length >= 15, `Only ${dateien.length} source files found`);

  let geprueft = 0;
  const fest = [];
  for (const [rel, src] of dateien)
    for (const muster of LOWER)
      for (const m of src.matchAll(muster)) {
        geprueft++;
        // At least two consecutive letters — „…" is not text.
        if (!/[^\W\d_]{2,}/u.test(m[1])) continue;
        const row = src.slice(0, m.index).split('\n').length;
        fest.push(`${rel}:${row}  „${m[1].slice(0, 50)}"`);
      }
  // Self-proof: if no pattern triggers any more, the list would be empty and the test
  // green without having checked anything.
  // Since 27.10. there are 0: the literals were emoji („✅", „⏳") and have
  // given way to the symbol family. The self-proof therefore checks the patterns on
  // a probe — each must trigger there exactly once.
  const probe = `a.textContent = 'Hallo'; b.title = "Welt"; toast('Text'); toast("Text"); confirm('Ja?'); alert('Nein');`;
  for (const muster of LOWER)
    assert.equal([...probe.matchAll(muster)].length, 1, `The pattern ${muster} no longer matches`);
  void geprueft;

  assert.deepEqual(
    fest.sort(),
    [],
    'These texts are hard-coded in the source instead of in the dictionary:\n  ' +
      fest.join('\n  ') +
      '\nIn an English interface a German word then shows up. For a ' +
      'button label that comes back after the click, buttonBusy() helps ' +
      '(dom.js): it REMEMBERS the text instead of inventing a second one.',
  );
});
