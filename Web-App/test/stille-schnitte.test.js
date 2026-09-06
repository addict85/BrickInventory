/**
 * Kein Testausschnitt, auf dem NUR verneinende Zusicherungen stehen, darf
 * ungesichert geschnitten sein.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Die Tests dieses Baums lesen Quelltext und schneiden Ausschnitte heraus:
 *
 *     const fn = src.slice(src.indexOf('async function x'), …);
 *
 * Fehlt der Ankertext, liefert indexOf -1, und `slice(-1)` gibt EIN Zeichen.
 * Was danach kommt, entscheidet, ob das auffaellt:
 *
 *     assert.match(fn, …)         auf leerem Text ROT   -> faellt auf
 *     assert.ok(fn.includes(…))   auf leerem Text ROT   -> faellt auf
 *     assert.doesNotMatch(fn, …)  auf leerem Text GRUEN -> SCHWEIGT
 *
 * Nachgemessen: 106 solche Schnitte, davon 101 mit mindestens einer positiven
 * Zusicherung — die melden sich selbst. Vier trugen ausschliesslich
 * `doesNotMatch`. Sie sind auf abschnitt() umgestellt, das bei fehlendem Anker
 * wirft.
 *
 * ── Warum das kein erfundenes Risiko ist ────────────────────────────────────
 * Genau dieser Fall ist in dieser Sitzung eingetreten: Beim Verschieben von
 * estimateFigPriceFromParts nach utils/marketPrice.ts zeigten mehrere Schnitte
 * ins Leere. Sie fielen auf, WEIL dort `assert.match` stand. Haette an einer
 * dieser Stellen `doesNotMatch` gestanden, waere sie gruen geblieben — und
 * niemand haette gemerkt, dass sie seither nichts mehr prueft.
 *
 * Ausfuehren: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Zusicherungen, die auf einem LEEREN Ausschnitt gruen bleiben. */
const VERNEINEND = new Set(['doesNotMatch', 'doesNotThrow', 'notMatch']);

test('kein Ausschnitt mit nur verneinenden Zusicherungen ist ungesichert', () => {
  const dateien = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
  assert.ok(dateien.length > 100, `Nur ${dateien.length} Testdateien — Ordner umbenannt?`);

  const still = [];
  let geprueft = 0;

  for (const datei of dateien) {
    const src = fs.readFileSync(path.join(__dirname, datei), 'utf8');
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(\w+)\.slice\(\s*\2\.indexOf\(/g)) {
      const ziel = m.group ? m.group(1) : m[1];
      geprueft++;

      // Der umgebende Testblock, grob: bis zum naechsten "\n});"
      let block = src.slice(m.index + m[0].length, m.index + m[0].length + 3000);
      const ende = block.indexOf('\n});');
      if (ende > 0) block = block.slice(0, ende);

      // Welche Zusicherungen laufen auf diesem Ausschnitt?
      const arten = [...block.matchAll(new RegExp(`assert\\.(\\w+)\\(\\s*${ziel}\\b`, 'g'))]
        .map(a => a[1]);
      if (!arten.length) continue;                       // wird nur weitergereicht
      if (arten.some(a => !VERNEINEND.has(a))) continue; // eine positive genuegt

      // ── Doch abgesichert? ──────────────────────────────────────────────────
      // Manche Stellen pruefen nicht den Ausschnitt selbst, sondern einen
      // daraus abgeleiteten Index (`assert.ok(iCache > 0 …)`). Auf leerem Text
      // ist der -1, und die Zusicherung faellt — das genuegt.
      // Genau so ein Fall ist img-proxy.test.js; ihn zu melden waere ein
      // Fehlalarm gewesen.
      const abgeleitet = new RegExp(`(\\w+)\\s*=\\s*${ziel}\\.indexOf\\(`, 'g');
      const indizes = [...block.matchAll(abgeleitet)].map(a => a[1]);
      if (indizes.some(n => new RegExp(`assert\\.ok\\([^)]*\\b${n}\\b\\s*[><!=]`).test(block))) continue;

      still.push(`${datei}:${src.slice(0, m.index).split('\n').length}  (${[...new Set(arten)].join(', ')})`);
    }
  }

  // Selbstbeweis: Findet die Suche keine Schnitte, waere die Zusicherung
  // darunter still gruen — dieselbe Fehlerart, gegen die dieser Test gebaut
  // ist. GEMESSEN sind es 102.
  assert.ok(geprueft > 50,
    `Nur ${geprueft} Schnitte gefunden (gemessen: 102) — das Suchmuster ist veraltet.`);

  assert.deepEqual(still, [],
    'Auf diesen Ausschnitten stehen NUR verneinende Zusicherungen, und der Schnitt ' +
    'ist ungesichert. Zeigt der Ankertext eines Tages ins Leere, bleibt der Test ' +
    'gruen und prueft nichts mehr. Bitte abschnitt() aus test/helpers/sources.js ' +
    'benutzen — das wirft, wenn der Anker fehlt.');
});
