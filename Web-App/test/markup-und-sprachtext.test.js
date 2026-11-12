/**
 * Was im Markup steht, ist auch das, was der Sprachtext sagt.
 *
 * ── Gegenproben (durchgeführt, Ergebnisse abgeschrieben) ────────────────────
 *
 *   A  ein Markup-Text wieder abweichend gesetzt
 *      → „jeder Rückfalltext zeigt, was der Sprachtext sagt" rot, nennt ihn
 *   B  das `(Admin)`-Feld zurück unter ein `data-i18n`-Element
 *      → „kein Element mit data-i18n hat Kind-Elemente" rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/** Im Textknoten maskiert, was dort maskiert gehört. */
const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function sprachtexte() {
  const de = fs.readFileSync(path.join(ROOT, 'public', 'locales', 'de.js'), 'utf8');
  return new Map(
    [...de.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)].map(m => [m[1], m[2].replace(/\\'/g, "'")]),
  );
}

test('jeder Rückfalltext zeigt, was der Sprachtext sagt', () => {
  const texte = sprachtexte();
  const stellen = [...HTML.matchAll(/(<[a-z]+\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([^<]+)</g)];
  // Selbstbeweis: GEMESSEN sind es über 200. Findet die Ableitung nichts,
  // wäre die Schleife still grün.
  assert.ok(stellen.length > 150, `Nur ${stellen.length} Stellen abgeleitet — greift die Suche noch?`);

  const abweichend = [];
  let geprueft = 0;
  for (const [, tag, schluessel, text] of stellen) {
    if (tag.includes('data-i18n-attr')) continue; // Ausnahme 1
    const soll = texte.get(schluessel);
    if (soll === undefined) continue; // i18n.test.js deckt fehlende Schlüssel ab
    if (soll.includes('{')) continue; // Ausnahme 2
    geprueft++;
    if (escHtml(soll) !== text.trim()) abweichend.push(`${schluessel}: Markup "${text.trim()}" ≠ "${soll}"`);
  }
  assert.ok(geprueft > 100, `Nur ${geprueft} Stellen wirklich geprüft — greifen die Ausnahmen zu breit?`);
  assert.deepEqual(
    abweichend,
    [],
    `${abweichend.length} Rückfalltexte weichen vom Sprachtext ab:\n  ` +
      abweichend.join('\n  ') +
      '\n\nSichtbar ist der SPRACHTEXT. Der Text im Markup ist nur der Rückfall ' +
      'für den Augenblick vor dem Übersetzen — laufen sie auseinander, sieht man ' +
      'beim Entwickeln das eine und im Betrieb das andere.',
  );
});

test('kein Element mit data-i18n hat Kind-Elemente', () => {
  const schlimm = [];
  for (const m of HTML.matchAll(/<([a-z]+)\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>/g)) {
    if (m[2].includes('data-i18n-attr')) continue;
    const tag = m[1];
    const rest = HTML.slice(m.index + m[0].length);
    // Bis zum passenden Schluss-Tag, verschachtelte gleichnamige mitgezählt.
    let tiefe = 1,
      i = 0,
      ende = -1;
    while (i < rest.length && tiefe > 0) {
      const auf = rest.indexOf('<' + tag, i);
      const zu = rest.indexOf('</' + tag, i);
      if (zu === -1) break;
      if (auf !== -1 && auf < zu) {
        tiefe++;
        i = auf + 1;
      } else {
        tiefe--;
        i = zu + 1;
        ende = zu;
      }
    }
    const inhalt = ende === -1 ? '' : rest.slice(0, ende);
    if (/<[a-z]/i.test(inhalt)) schlimm.push(`${m[3]}: <${tag}> enthält ${inhalt.match(/<[a-z][^\s>]*/i)[0]}…`);
  }
  assert.deepEqual(
    schlimm,
    [],
    'Diese Elemente tragen `data-i18n` UND Kind-Elemente:\n  ' +
      schlimm.join('\n  ') +
      '\n\n`textContent` ersetzt den GANZEN Inhalt — die Kinder sind beim ersten ' +
      'Übersetzen weg. Den Schlüssel an ein inneres Feld hängen.',
  );
});
