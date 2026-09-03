/**
 * Eine Kachel, mehrere Besitzer — welchen Preis zeigt sie?
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * /finance/pnl liefert eine Zeile JE BESITZER; die Finanztabelle zeigt sie so,
 * mit Besitzer-Plakette. Die Galerie fasst im Haushalt dieselbe Setnummer zu
 * EINER Kachel zusammen. `enrichGalleryWithPrices()` baute daraus eine Zuordnung
 * `set_number -> Preis` — die zuletzt gelesene Zeile gewann.
 *
 * ── Wie eng der Fall wirklich ist ───────────────────────────────────────────
 * NACHGEMESSEN, und schmaler als zunächst angenommen: Sind Kaufpreise ERFASST
 * (der Normalfall), rechnet der Server den mengengewichteten Wert bereits je
 * Zeile aus. Zwei Konten mit 600 und 100 ergaben in BEIDEN Zeilen 350 —
 * „letzte gewinnt" traf also zufällig das Richtige.
 *
 * Fehlen die Erfassungen und steht nur noch sets.purchase_price (Altdaten,
 * oder alle Kaufpreise eines Sets wieder entfernt), fallen die Zeilen
 * auseinander: 100 → 750 %, 600 → 41,7 %. Die Kachel nahm eine davon.
 *
 * ── Was jetzt gilt ──────────────────────────────────────────────────────────
 * Bei mehreren Zeilen wird nach Menge gewichtet, gerechnet über
 * `baseline_price` (Kaufpreis wenn bekannt, sonst erster beobachteter
 * Marktpreis). Beide Fälle ergeben dasselbe: 350 und 142,9 %.
 *
 * Bei EINER Zeile bleibt der Wert des Servers unverändert — dieselbe Rechnung
 * ein zweites Mal wäre eine zweite Gelegenheit abzuweichen.
 *
 * Geprüft wird die Rechnung selbst, ohne Browser: Die Zuordnung entsteht in
 * einer Schleife über die Antwort, und genau die wird hier nachgestellt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const JS = path.join(__dirname, '..', 'public', 'js', '07-admin.js');

/**
 * Die Schleife aus enrichGalleryWithPrices() ausführen.
 *
 * Herausgeschnitten statt nachgebaut: Eine Kopie der Rechnung im Test wäre
 * genau die zweite Wahrheit, um die es hier geht. Der Ausschnitt beginnt bei
 * `const jeSet` und endet vor `setAllSets(` — dazwischen steht nichts als die
 * Zuordnung.
 */
function baueZuordnung(sets) {
  const src = ohneKommentare(fs.readFileSync(JS, 'utf8'));
  const von = src.indexOf('const jeSet = new Map();');
  const bis = src.indexOf('setAllSets(');
  assert.ok(von > 0 && bis > von,
    'Die Schleife in enrichGalleryWithPrices() ist nicht mehr zu finden — umgebaut?');
  const code = src.slice(von, bis);
  // _pnlCache wird im echten Modul aus 02-gallery.js importiert; hier genügt
  // ein leeres Objekt, in das die Schleife schreibt.
  const _pnlCache = {};
  const pnl = { sets };
  // eslint-disable-next-line no-new-func
  new Function('pnl', '_pnlCache', code)(pnl, _pnlCache);
  return _pnlCache;
}

test('mehrere Besitzer: der Kachelpreis wird nach Menge gewichtet', () => {
  // Der gemessene Fall ohne Erfassungszeilen: zwei Konten, ein Set, 600 und 100.
  const z = baueZuordnung([
    { set_number: '75192-1', quantity: 1, baseline_price: 600, current_price: 850, baseline_pnl_pct: '41.7' },
    { set_number: '75192-1', quantity: 1, baseline_price: 100, current_price: 850, baseline_pnl_pct: '750.0' },
  ]);
  assert.equal(z['75192-1'].pnl_pct, '142.9',
    'Gewichtet über beide Exemplare: (600+100)/2 = 350, gegen 850 sind das 142,9 % — ' +
    'nicht 41,7 % oder 750 %, je nachdem welche Zeile zuletzt gelesen wurde');
  assert.equal(z['75192-1'].price, 850, 'Der Marktpreis ist in beiden Zeilen derselbe');
});

test('mehrere Besitzer mit erfassten Kaufpreisen: unveraendert', () => {
  // Der Normalfall: Der Server hat schon gewichtet, beide Zeilen tragen 350.
  const z = baueZuordnung([
    { set_number: '75192-1', quantity: 1, baseline_price: 350, current_price: 850, baseline_pnl_pct: '142.9' },
    { set_number: '75192-1', quantity: 1, baseline_price: 350, current_price: 850, baseline_pnl_pct: '142.9' },
  ]);
  assert.equal(z['75192-1'].pnl_pct, '142.9', 'dasselbe Ergebnis wie vorher');
});

test('unterschiedliche Mengen zaehlen unterschiedlich schwer', () => {
  // Drei Exemplare zu 100, eines zu 500: (3·100 + 500)/4 = 200.
  const z = baueZuordnung([
    { set_number: '6346-1', quantity: 3, baseline_price: 100, current_price: 400, baseline_pnl_pct: '300.0' },
    { set_number: '6346-1', quantity: 1, baseline_price: 500, current_price: 400, baseline_pnl_pct: '-20.0' },
  ]);
  assert.equal(z['6346-1'].pnl_pct, '100.0',
    'Gewichtet: 200 Kaufpreis gegen 400 Markt. Ein einfacher Mittelwert ergäbe 300 und damit 33,3 %');
});

test('eine Zeile: der Wert des Servers bleibt unangetastet', () => {
  const z = baueZuordnung([
    // pnl_pct und baseline_pnl_pct sind hier absichtlich verschieden: Die
    // Kachel nimmt baseline_pnl_pct, und genau das muss durchkommen.
    { set_number: '21318-1', quantity: 2, baseline_price: 7, current_price: 400, pnl_pct: '1.1', baseline_pnl_pct: '77.7' },
  ]);
  assert.equal(z['21318-1'].pnl_pct, '77.7',
    'Bei einer Zeile wird nicht neu gerechnet — sonst stünde hier 5614,3 %');
});

test('ohne Kaufpreis und ohne Marktpreis steht kein Prozentwert', () => {
  const z = baueZuordnung([
    { set_number: '10290-1', quantity: 1, baseline_price: null, current_price: 0, baseline_pnl_pct: null },
    { set_number: '10290-1', quantity: 1, baseline_price: null, current_price: 0, baseline_pnl_pct: null },
  ]);
  assert.equal(z['10290-1'].pnl_pct, null,
    'Lieber keine Zahl als eine erfundene — der Server hält es genauso');
});
