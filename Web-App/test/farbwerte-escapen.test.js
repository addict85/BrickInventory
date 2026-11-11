/**
 * Ein Farbwert aus der Datenbank geht durch escHex(), bevor er in ein
 * style-Attribut kommt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', 'public', 'js');

test('Farbwerte kommen nur über escHex ins Markup', () => {
  const treffer = [];
  let gepruefte = 0;
  for (const f of fs.readdirSync(JS).filter(n => n.endsWith('.js') && n !== 'app.bundle.js')) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    src.split('\n').forEach((zeile, i) => {
      // Interpolierte Farbfelder: color_hex, colour_hex, .hex
      for (const m of zeile.matchAll(/\$\{([^{}]*(?:color_hex|colour_hex|\.hex)\b[^{}]*)\}/g)) {
        gepruefte++;
        // Zwei erlaubte Fassungen derselben Prüfung: escHex() liefert
        // `#RRGGBB` für style, hexZiffern() die nackten sechs Ziffern für
        // Attribute, deren Leser das Doppelkreuz selbst ergänzen.
        if (!m[1].includes('escHex(') && !m[1].includes('hexZiffern('))
          treffer.push(`${f}:${i + 1}  \${${m[1].trim()}}`);
      }
    });
  }
  // Selbstbeweis: Ohne Fundstellen sagt eine leere Liste nichts — die Regel
  // wäre auch dann grün, wenn niemand mehr Farben anzeigte.
  assert.ok(gepruefte >= 5,
    `nur ${gepruefte} interpolierte Farbwerte gefunden — Feldname geändert?`);
  assert.deepEqual(treffer, [],
    'Diese Stellen schreiben einen Farbwert roh ins Markup:\n  ' + treffer.join('\n  ') +
    '\nescHex(wert, rückfall) prüft auf sechs Hexziffern und liefert sonst den ' +
    'Rückfall — siehe den Hinweis in escapen.js.');
});
