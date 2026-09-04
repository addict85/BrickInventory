/**
 * Ein Farbwert aus der Datenbank geht durch escHex(), bevor er in ein
 * style-Attribut kommt.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * 01-core.js hat escHex() genau dafür, und der Kommentar dort sagt es
 * ausdrücklich: „Farbwert in style="" → escHex()". Benutzt hat es aber nur
 * 03-parts.js — das Modul, in dem die Funktion ursprünglich stand. Drei andere
 * schrieben den Wert roh hinein:
 *
 *     style="background:#${p.color_hex}"        06-minifigs.js
 *     background:#${grp.color_hex};             08-init.js
 *     background:#${item.color_hex};            13-acquisition-modals.js
 *
 * Wieder dieselbe Form: eine Regel, eine Fassung, und drei Stellen, die sie
 * nie bekommen haben.
 *
 * ── Warum das nicht bloss Ordnung ist ───────────────────────────────────────
 * Die Werte kommen aus rb_colors.rgb, also aus dem Rebrickable-Katalog. Ein
 * unerwarteter Inhalt bricht im besten Fall das Layout — und ein Wert mit
 * einem Anführungszeichen bricht aus dem style-Attribut heraus. escHex()
 * prüft auf genau sechs Hexziffern und liefert sonst den Rückfall.
 *
 * ── Warum die Regel eng gefasst ist ─────────────────────────────────────────
 * Eine Prüfung „jede Interpolation muss escaped sein" hätte 917 Fundstellen
 * und hunderte Fehlalarme — Übersetzungen, Zahlen, eigene Konstanten. Ein
 * Test, der korrekten Code anmeckert, wird abgeschaltet statt befolgt. Diese
 * Regel fragt nur nach FARBWERTEN, und dort ist die Antwort eindeutig.
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
    'Rückfall — siehe den Hinweis in 01-core.js.');
});
