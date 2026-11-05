/**
 * Beide Oberflächen rechnen keine Geldbeträge nach.
 *
 * Die Regel, was zu einer Summe zählt, steht nur im Server; summierte eine
 * Oberfläche selbst, zeigten Webapp und Android-App bei der nächsten Änderung
 * verschiedene Zahlen. Gesucht wird nach der FORM einer Geldsumme
 * (`reduce`/`sumOf` über ein Feld, dessen Name auf Geld deutet), nicht nach
 * einzelnen Feldnamen; jede Fundstelle braucht einen ausdrücklichen Freibrief.
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
  const fc = require('./helpers/sources').finanzQuelle();
  assert.match(fc, /grand_total: totalCurrent\.toFixed\(2\)/,
    'src/finanzen/financeCalc.ts liefert keinen Gesamtwert mehr — dann rechnen ihn ' +
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
