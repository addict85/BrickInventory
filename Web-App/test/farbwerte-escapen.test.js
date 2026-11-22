/**
 * A color value from the database goes through escHex() before it gets into a
 * style attribute.
 *
 * Counter-check: in public/js/init.js grp.color_hex interpolated without escHex → red “color values only get into the markup via escHex”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');

test('color values only get into the markup via escHex', () => {
  const treffer = [];
  let checked = 0;
  for (const f of fs.readdirSync(JS).filter(n => n.endsWith('.js') && n !== 'app.bundle.js')) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    src.split('\n').forEach((row, i) => {
      // Interpolated color fields: color_hex, colour_hex, .hex
      for (const m of row.matchAll(/\$\{([^{}]*(?:color_hex|colour_hex|\.hex)\b[^{}]*)\}/g)) {
        checked++;
        // Two allowed versions of the same check: escHex() delivers
        // `#RRGGBB` for style, rawHex() the bare six digits for
        // attributes whose readers add the hash themselves.
        if (!m[1].includes('escHex(') && !m[1].includes('rawHex(')) treffer.push(`${f}:${i + 1}  \${${m[1].trim()}}`);
      }
    });
  }
  // Self-proof: without locations an empty list says nothing — the rule
  // would also be green if nobody displayed colors anymore.
  assert.ok(checked >= 5, `nur ${checked} interpolierte Farbwerte gefunden — Feldname geändert?`);
  assert.deepEqual(
    treffer,
    [],
    'Diese Stellen schreiben einen Farbwert roh ins Markup:\n  ' +
      treffer.join('\n  ') +
      '\nescHex(wert, rückfall) prüft auf sechs Hexziffern und liefert sonst den ' +
      'Rückfall — siehe den Hinweis in escaping.js.',
  );
});
