/**
 * Die Summenzeile der Erfassungen rechnet der SERVER — einmal.
 *
 * ── Woher dieser Test kommt (Marcos Frage) ──────────────────────────────────
 * „Kannst du sicherstellen, dass Berechnungen zentral in einer Komponente für
 * Webapp und Android-App durchgeführt werden, damit die GUIs nur das Rendering
 * übernehmen müssen?"
 *
 * Die Summe unter einer Erfassungsliste stand VIERMAL in den Oberflächen:
 * zweimal in `public/js/07-admin.js` (Set-Dialog und Dialog für manuelle
 * Einträge) und zweimal in der App (`AcquisitionManagementScreen`,
 * `ManualItemComposables`). Und die vier waren sich nicht einig, aus welchem
 * Feld der Preis kommt: Die Webapp las je nach Dialog fest `purchase_price`
 * ODER fest `unit_price`, die App hatte dafür eine Rückfallregel
 * (`purchasePrice ?: unitPrice`), die es in der Webapp gar nicht gibt. Dass
 * die Zahlen übereinstimmten, lag allein daran, dass die Abfragen je Art nur
 * EINES der beiden Felder füllen.
 *
 * Der Test hat zwei Teile, und beide werden gebraucht:
 *   • die RECHNUNG selbst (utils/acquisitions.ts) — Randfälle inklusive
 *   • die REGEL, dass keine Oberfläche sie nochmal anstellt. Ohne den zweiten
 *     Teil wäre der erste in dem Moment wertlos, in dem jemand die Summe
 *     „schnell im Frontend" wieder einbaut.
 *
 * Gegenprobe (durchgeführt): `amount` in acquisitionTotals() auf 0 statt null
 * bei fehlenden Preisen → der Randfall-Teilschritt wird rot. Und ein
 * eingefügtes `acqs.reduce(...)` in 07-admin.js → der Regel-Teilschritt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');
const { acquisitionTotals } = require(path.join(ROOT, 'dist/utils/acquisitions.js'));

// ── Teil 1: die Rechnung ────────────────────────────────────────────────────

test('Menge und Betrag: mengengewichtet über alle Zeilen', () => {
  const t = acquisitionTotals([
    { quantity: 2, purchase_price: '7.41' },   // aus Postgres kommen NUMERIC als Text
    { quantity: 1, purchase_price: 9.48 },
  ]);
  assert.equal(t.quantity, 3);
  assert.equal(t.amount, 24.3);               // 2×7.41 + 1×9.48
  assert.equal(t.priced_rows, 2);
});

test('unit_price zählt genauso wie purchase_price', () => {
  // Manuelle Teile und Minifiguren führen den Preis in unit_price. Die
  // Rückfallregel steht deshalb HIER und nicht in einem der Clients.
  assert.equal(acquisitionTotals([{ quantity: 3, unit_price: 0.6 }]).amount, 1.8);
});

test('ohne Preis ist der Betrag null — nicht 0', () => {
  // „Nichts erfasst" ist etwas anderes als „für null Franken gekauft". Nur mit
  // null kann die Oberfläche den Gedankenstrich zeigen, ohne selbst zu raten;
  // mit 0 müsste jede Ansicht dieselbe Auslegung noch einmal treffen.
  const t = acquisitionTotals([{ quantity: 2 }, { quantity: 1, purchase_price: null }]);
  assert.equal(t.quantity, 3, 'die Stücke sind da, auch ohne Preis');
  assert.equal(t.amount, null);
  assert.equal(t.priced_rows, 0);
});

test('eine Zeile mit Preis 0 ist erfasst und ergibt 0', () => {
  // Abgrenzung zum Fall darüber: 0 ist ein Preis, kein fehlender Wert —
  // sonst verschwände ein geschenktes Set aus der Zählung.
  const t = acquisitionTotals([{ quantity: 1, purchase_price: 0 }]);
  assert.equal(t.amount, 0);
  assert.equal(t.priced_rows, 1);
});

test('gemischt: Zeilen mit und ohne Preis', () => {
  const t = acquisitionTotals([
    { quantity: 2, purchase_price: 10 },
    { quantity: 5 },
  ]);
  assert.equal(t.quantity, 7, 'die preislose Zeile zählt bei der MENGE mit');
  assert.equal(t.amount, 20, 'beim BETRAG nicht — sie hat keinen');
});

test('der Betrag ist auf zwei Stellen gerundet', () => {
  // 3 × 11.326666 ergibt sonst 33.980000000000004 auf dem Schirm.
  const t = acquisitionTotals([{ quantity: 3, purchase_price: 11.326666 }]);
  assert.equal(String(t.amount).split('.')[1]?.length <= 2, true, `war: ${t.amount}`);
});

test('leere Liste', () => {
  assert.deepEqual(acquisitionTotals([]), { quantity: 0, amount: null, priced_rows: 0 });
  assert.deepEqual(acquisitionTotals(null), { quantity: 0, amount: null, priced_rows: 0 });
});

// ── Teil 2: die Regel ───────────────────────────────────────────────────────

test('alle drei Erfassungs-Routen liefern die Summe mit', () => {
  const src = ohneKommentare(fs.readFileSync(
    path.join(ROOT, 'routes/api_v1/acquisitions.ts'), 'utf8'));
  const treffer = [...src.matchAll(/res\.json\(\{[^}]*acquisitions:/g)];
  assert.ok(treffer.length >= 3, `nur ${treffer.length} Antworten mit Erfassungen gefunden`);
  for (const m of treffer) {
    const zeile = src.slice(m.index, src.indexOf('\n', m.index));
    assert.match(zeile, /totals:/,
      `Eine Erfassungs-Antwort ohne totals — die Oberfläche müsste dann wieder ` +
      `selbst rechnen: ${zeile.trim()}`);
  }
});

test('keine Oberfläche rechnet die Summe noch einmal', () => {
  // Fundort seit Nachtrag 130: Das Kaufpreis-Modal liegt in
  // js/13-acquisition-modals.js. Der Helfer nimmt beide Dateien, damit die
  // Prüfung ihre Aussage behält, egal wo die Zeile künftig steht.
  const js = ohneKommentare(require('./helpers/sources').adminQuelle());
  // Genau die vier Muster, die vorher dort standen.
  for (const muster of [
    /reduce\(\([^)]*\)\s*=>\s*[a-z]\s*\+\s*\(?[a-z]\.(purchase_price|unit_price)/,
    /reduce\(\([^)]*\)\s*=>\s*[a-z]\s*\+\s*[a-z]\.quantity/,
  ]) {
    assert.doesNotMatch(js, muster,
      'Die Summenzeile wird im Frontend wieder selbst gerechnet — sie kommt als ' +
      '`totals` vom Server (utils/acquisitions.ts)');
  }
  assert.match(js, /function acqSummary\(totals\)/,
    'Es soll EINEN Zeichner für die Summenzeile geben, nicht zwei Fassungen');
  assert.match(js, /totals\?\.amount/,
    'Der Zeichner muss den Serverwert lesen');
});
