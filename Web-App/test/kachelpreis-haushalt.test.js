/**
 * Eine Kachel, mehrere Besitzer — welchen Preis und welche G&V zeigt sie?
 *
 * /finance/pnl liefert eine Zeile je Besitzer; die Galerie fasst dieselbe
 * Setnummer zu einer Kachel zusammen. Bei mehreren Zeilen wird nach Menge
 * gewichtet (über baseline_price), bei einer bleibt der Wert des Servers.
 * Seit kachel_preis und kachel_pnl_pct rechnet das der Server
 * (src/finanzen/setValue.ts kachelWerte); Web und App zeigen nur an.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in kachelWerte() bei mehreren Zeilen die letzte statt der gewichteten
 *      nehmen → rot: „nach Menge gewichtet“ (750 statt 142,9)
 *   B  bei einer Zeile pnl_pct vor baseline_pnl_pct → rot: „der Wert des
 *      Servers bleibt“ (1,1 statt 77,7)
 *   C  in 07-admin.js wieder `price: s.current_price` → rot: „das Web
 *      übernimmt die Werte des Servers“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { kachelWerte } = _req('src/finanzen/setValue.js');
const kachel = (zeilen, nr) => kachelWerte(zeilen.map(z => ({ purchase_price: null, pnl_pct: null, ...z }))).get(nr);

test('mehrere Besitzer: der Kachelpreis wird nach Menge gewichtet', () => {
  // Der gemessene Fall ohne Erfassungszeilen: zwei Konten, ein Set, 600 und 100.
  const k = kachel([
    { set_number: '75192-1', quantity: 1, baseline_price: 600, current_price: 850, baseline_pnl_pct: '41.7' },
    { set_number: '75192-1', quantity: 1, baseline_price: 100, current_price: 850, baseline_pnl_pct: '750.0' },
  ], '75192-1');
  assert.equal(k.kachel_pnl_pct, 142.9, '(600+100)/2 = 350 gegen 850 — nicht die zuletzt gelesene Zeile');
  assert.equal(k.kachel_preis, 850, 'Der Marktpreis ist in beiden Zeilen derselbe');
});

test('mehrere Besitzer mit erfassten Kaufpreisen: unveraendert', () => {
  const k = kachel([
    { set_number: '75192-1', quantity: 1, baseline_price: 350, current_price: 850, baseline_pnl_pct: '142.9' },
    { set_number: '75192-1', quantity: 1, baseline_price: 350, current_price: 850, baseline_pnl_pct: '142.9' },
  ], '75192-1');
  assert.equal(k.kachel_pnl_pct, 142.9);
});

test('unterschiedliche Mengen zaehlen unterschiedlich schwer', () => {
  // Drei Exemplare zu 100, eines zu 500: (3·100 + 500)/4 = 200.
  const k = kachel([
    { set_number: '6346-1', quantity: 3, baseline_price: 100, current_price: 400, baseline_pnl_pct: '300.0' },
    { set_number: '6346-1', quantity: 1, baseline_price: 500, current_price: 400, baseline_pnl_pct: '-20.0' },
  ], '6346-1');
  assert.equal(k.kachel_pnl_pct, 100, 'Gewichtet 200 gegen 400; ein einfacher Mittelwert ergäbe 33,3 %');
});

test('eine Zeile: der Wert des Servers bleibt', () => {
  const k = kachel([
    { set_number: '21318-1', quantity: 2, baseline_price: 7, current_price: 400, pnl_pct: '1.1', baseline_pnl_pct: '77.7' },
  ], '21318-1');
  assert.equal(k.kachel_pnl_pct, 77.7, 'Bei einer Zeile wird nicht neu gerechnet — sonst stünde hier 5614,3 %');
});

test('ohne Kaufpreis und ohne Marktpreis steht kein Prozentwert und kein Betrag', () => {
  const k = kachel([
    { set_number: '10290-1', quantity: 1, baseline_price: null, current_price: 0, baseline_pnl_pct: null },
    { set_number: '10290-1', quantity: 1, baseline_price: null, current_price: 0, baseline_pnl_pct: null },
  ], '10290-1');
  assert.deepEqual(k, { kachel_preis: null, kachel_pnl_pct: null });
});

test('das Web übernimmt die Werte des Servers', () => {
  // enrichGalleryWithPrices() mit einer Antwort ausführen und nachsehen, was
  // an der Kachel ankommt — ohne Browser, über die Modulfunktion selbst.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '07-admin.js'), 'utf8');
  const von = src.indexOf('  set_pnlCache({});');
  const bis = src.indexOf('  // Inject price data into cached sets');
  assert.ok(von > 0 && bis > von, 'enrichGalleryWithPrices() nicht gefunden — umgebaut?');
  const _pnlCache = {};
  // eslint-disable-next-line no-new-func
  new Function('pnl', '_pnlCache', 'set_pnlCache', src.slice(von, bis))(
    { sets: [{ set_number: 'A-1', current_price: 99, kachel_preis: 10.5, kachel_pnl_pct: 12.3 },
             { set_number: 'A-1', current_price: 99, kachel_preis: 10.5, kachel_pnl_pct: 12.3 }] },
    _pnlCache, () => {});
  assert.deepEqual(_pnlCache, { 'A-1': { price: 10.5, pnl_pct: 12.3 } });
});
