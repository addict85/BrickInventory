/**
 * Der KAUFPREIS kommt nie aus dem anderen Zustand.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 * „Bei den manuell erfassten Minifiguren scheint der Zustand keinen
 * Unterschied auf den Preis zu haben. Wenn ich eine Minifigur mit dem Zustand
 * neu oder gebraucht erfasse, erhält diese denselben Preis."
 *
 * Genau so war es, und der Grund steht in utils/financeCalc.ts:
 * `fetchMinifigPrice` fällt bei leerem Price Guide auf den jeweils ANDEREN
 * Zustand zurück und markiert das (`is_fallback`, `condition_used`).
 * `getCurrentFigMarketPrice` las nur `avg_price` und warf die Markierung weg.
 *
 * Bei Minifiguren hat BrickLink meist nur zu einem Zustand Verkäufe — also
 * lieferten „Neu" und „Gebraucht" denselben Wert, und der Zustand sah aus wie
 * eine Angabe ohne Wirkung.
 *
 * ── Warum der Rückfall bleibt, aber nicht hier ──────────────────────────────
 *
 * Für die BEWERTUNG ist er richtig: Ein Näherungswert ist besser als eine
 * Lücke, und dort steht er als Schätzung neben anderen Schätzungen. Für den
 * KAUFPREIS nicht — der wird gespeichert und steht danach als Tatsache da.
 * Lieber kein Vorschlag als ein falscher.
 *
 * ── Und beide Wege, nicht einer ─────────────────────────────────────────────
 *
 * Teile und Minifiguren sind Zwillinge; eine Regel nur auf einer Seite
 * nachzuziehen ist in diesem Baum mehrfach schiefgegangen (zuletzt beim
 * `?? 0` des Kaufpreises). Deshalb prüft dieser Test BEIDE.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
/**
 * Quelltext OHNE Kommentare.
 *
 * Nicht Zierde: Der Erklärtext an der geprüften Stelle NENNT `is_fallback` —
 * die erste Fassung dieses Tests blieb deshalb grün, nachdem ich die Zeile
 * zum Ausprobieren gelöscht hatte. Ein Test, der seinen eigenen Kommentar
 * mitliest, prüft nichts. Dieselbe Falle, gegen die es helpers/sources.js
 * überhaupt gibt.
 */
const lies = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Der Rumpf einer Funktion, in ZEILEN geschnitten (siehe helpers/sources.js). */
function rumpf(src, name) {
  const i = src.indexOf(name);
  assert.ok(i > 0, `${name} nicht gefunden`);
  return src.slice(i).split('\n').slice(1)
    .reduce((acc, z) => (acc.fertig || /^(async )?function |^const .* = async/.test(z)
      ? { ...acc, fertig: true } : { ...acc, text: acc.text + '\n' + z }),
      { text: '', fertig: false }).text;
}

test('der Kaufpreis-Vorschlag verwirft einen Preis aus dem anderen Zustand', () => {
  for (const [datei, name] of [
    ['routes/minifigs.ts', 'async function getCurrentFigMarketPrice'],
    ['routes/parts.ts',    'async function getCurrentPartMarketPrice'],
  ]) {
    const body = rumpf(lies(datei), name);
    assert.match(body, /is_fallback/,
      `${datei}: ${name} beachtet den Rückfall-Vermerk nicht — dann liefern ` +
      '„Neu" und „Gebraucht" wieder denselben Preis, sobald BrickLink nur zu ' +
      'einem Zustand Verkäufe hat.');
  }
});

/**
 * Und die Markierung, ohne die die Regel oben ins Leere liefe.
 *
 * Fällt `is_fallback` in financeCalc weg, ist die Prüfung darüber zwar noch
 * grün, aber wirkungslos — dieselbe Sorte stiller Ausfall wie ein Attribut,
 * das niemand auswertet.
 */
test('der Rückfall wird in beiden Preisabrufen markiert', () => {
  const fc = lies('utils/financeCalc.ts');
  for (const name of ['async function fetchMinifigPrice', 'async function fetchPartPrice']) {
    const body = rumpf(fc, name);
    assert.match(body, /is_fallback:\s*true/,
      `${name} markiert den Zustands-Rückfall nicht mehr — die Regel in ` +
      'routes/*.ts kann ihn dann nicht erkennen.');
  }
});
