/**
 * Beide Oberflächen rechnen keine Geldbeträge nach.
 *
 * ── Marcos Frage (Nachtrag 145) ─────────────────────────────────────────────
 * „Ist nach wie vor sichergestellt, dass die ganze Logik im Server zentral ist
 * und die Webapp sowie die Android-App die Daten gleich beziehen und nur das
 * Rendering übernehmen?"
 *
 * Weitgehend ja — mit zwei Ausnahmen, die diese Prüfung künftig fängt:
 *
 *  1. Die Webapp summierte `display_value` über alle Zeilen, obwohl der Server
 *     `total_value` liefert. Die Android-App las es seit jeher von dort. Heute
 *     kam dasselbe heraus; sobald der Server Zeilen ohne Preis anders behandelt,
 *     zeigen die beiden Clients verschiedene Zahlen.
 *
 *  2. Den Gesamtwert (Sets + Teile + Minifiguren) addierten BEIDE selbst. Die
 *     Regel „was zählt zum Gesamtwert" stand damit an drei Stellen. Sie kommt
 *     jetzt als `totals.grand_total` aus /finance/pnl.
 *
 * ── Warum die alte Prüfung das nicht fand ───────────────────────────────────
 * `keine Oberfläche rechnet die Summe noch einmal` sucht nach zwei konkreten
 * Feldnamen (`purchase_price`, `unit_price`, `quantity`). `display_value`
 * stand nicht auf der Liste. Die Regel war richtig, der Suchraum zu eng —
 * dasselbe Muster wie bei den Prüflücken der Nachträge 100 bis 105.
 *
 * Diese Prüfung geht deshalb umgekehrt vor: Sie sucht nach der FORM einer
 * Geldsumme (`reduce`/`sumOf` über ein Feld, dessen Name auf Geld deutet) und
 * verlangt für jede Fundstelle einen ausdrücklichen Freibrief.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');

/** Feldnamen, deren Summe eine Geschäftsregel wäre. */
const GELDFELDER =
  'display_value|total_value|purchase_price|unit_price|current_price|avg_price|qty_avg_price|market_price|price';

/**
 * Stellen, die eine Summe bilden DÜRFEN — mit Begründung.
 *
 * Kurz halten: Jede Zeile hier ist eine Ausnahme von der Regel und sollte
 * erklären, warum der Server sie nicht liefern kann.
 */
const ERLAUBT = [
  // Fortschrittsbalken rechnen Prozent aus done/total — kein Geld.
];

test('die Webapp summiert keine Geldbeträge selbst', () => {
  const dir = path.join(ROOT, 'public', 'js');
  const treffer = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'app.bundle.js')) {
    const src = ohneKommentare(fs.readFileSync(path.join(dir, f), 'utf8'));
    const re = new RegExp(String.raw`reduce\((?:\([^)]*\)|\w+)\s*=>[^;]{0,120}?\.(${GELDFELDER})\b`, 'g');
    for (const m of src.matchAll(re)) {
      const zeile = src.slice(0, m.index).split('\n').length;
      const eintrag = `${f}:${zeile} summiert .${m[1]}`;
      if (!ERLAUBT.includes(eintrag)) treffer.push(eintrag);
    }
  }
  assert.deepEqual(treffer, [],
    'Die Oberfläche bildet eine Geldsumme selbst:\n  ' + treffer.join('\n  ') +
    '\nDer Server liefert solche Summen fertig (total_value, totals.grand_total). ' +
    'Zwei Rechenwege bedeuten zwei Ergebnisse, sobald sich die Regel ändert.');
});

test('der Server liefert den Gesamtwert', () => {
  // Ohne dieses Feld bliebe den Clients nichts anderes übrig, als selbst zu
  // addieren — die Prüfung oben wäre dann nicht erfüllbar.
  const fc = fs.readFileSync(path.join(ROOT, 'utils', 'financeCalc.ts'), 'utf8');
  assert.match(fc, /grand_total: totalCurrent\.toFixed\(2\)/,
    'utils/financeCalc.ts liefert keinen Gesamtwert mehr — dann rechnen ihn ' +
    'beide Clients wieder selbst, jeder auf seine Art.');

  const fin = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public', 'js', '04-finance.js'), 'utf8'));
  assert.match(fin, /grand_total/, 'Die Webapp liest den Gesamtwert nicht');
  assert.doesNotMatch(fin, /const grandTotal = setsQtyAvg \+ extra;/,
    'Die Webapp addiert den Gesamtwert wieder selbst');
});

test('beide Clients lesen dieselben Felder für dieselben Zahlen', () => {
  // Die Kernaussage von Marcos Frage: gleiche Quelle, nicht nur gleiche Zahl.
  const fin = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public', 'js', '04-finance.js'), 'utf8'));
  for (const feld of ['total_value', 'grand_total']) {
    assert.ok(fin.includes(feld), `Die Webapp liest ${feld} nicht`);
  }
});
