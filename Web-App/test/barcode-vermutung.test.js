/**
 * Eine geratene Setnummer muss als Vermutung erkennbar sein.
 *
 * ── Marcos Meldung ──────────────────────────────────────────────────────────
 * „Es werden regelmässig falsche Nummern erkannt."
 *
 * Die Barcode-Route hat sieben Wege zu einer Setnummer. Fünf gleichen eine
 * KENNUNG ab, zwei raten — und beide antworteten mit `success: true` und einer
 * konkreten Nummer, für die App nicht von einem Treffer zu unterscheiden.
 *
 *   rebrickable-search  wird GENAU DANN erreicht, wenn die exakte Prüfung
 *                       `extIds.includes(ean13)` vorher fehlschlug. Nimmt dann
 *                       das erste Suchergebnis mit `year > 2010 && num_parts > 0`
 *                       — nichts daran hat mit der gescannten EAN zu tun.
 *   upcitemdb           liest eine Zahl aus einem Produkttitel.
 *
 * ── Warum eine POSITIVliste ─────────────────────────────────────────────────
 * Unbekannte Quelle = Vermutung. Wer einen achten Weg einbaut, muss
 * ausdrücklich sagen, dass er eine Kennung abgleicht. Andersherum ginge ein
 * neuer Ratepfad still als geprüft durch — genau der Fehler, der hier behoben
 * wird.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { istVermutung, GEPRUEFT } = _req('utils/barcodeQuelle.js');
const { setnummerKandidaten } = _req('utils/produkttitel.js');

test('geprüfte Wege sind keine Vermutung', () => {
  for (const quelle of ['catalog_cache', 'rebrickable-ean', 'brickset-ean',
                        'brickset-item', 'rebrickable-direct']) {
    assert.equal(istVermutung(quelle), false, `${quelle} gilt als Vermutung`);
  }
  // Selbstbeweis: Wäre die Liste leer, bestünde die Schleife oben nicht.
  assert.ok(GEPRUEFT.size >= 5, `nur ${GEPRUEFT.size} geprüfte Quellen — Liste geschrumpft?`);
});

test('die zwei ratenden Wege sind als Vermutung markiert', () => {
  assert.equal(istVermutung('rebrickable-search'), true,
    'Der Zweig wird erreicht, NACHDEM der exakte EAN-Abgleich fehlschlug — ' +
    'er nimmt das erste Suchergebnis, das nur "nach 2010" und "hat Teile" erfüllt.');
  assert.equal(istVermutung('upcitemdb'), true,
    'Eine Zahl aus einem Produkttitel ist keine geprüfte Kennung.');
});

test('eine unbekannte Quelle gilt als Vermutung', () => {
  // Der Kern der Positivliste: Ein achter Weg ist automatisch unsicher, statt
  // still als Treffer durchzugehen.
  for (const quelle of ['irgendwas-neues', '', null, undefined]) {
    assert.equal(istVermutung(quelle), true, `"${quelle}" ging als geprüft durch`);
  }
});

test('aus dem Produkttitel gewinnt nicht mehr die erste Zahl', () => {
  // Hier stand match(/(\d{4,6})/) — die erste Zahl, egal welche.
  assert.equal(setnummerKandidaten('LEGO City 2023 Feuerwehrstation 60320')[0], '60320',
    'Das JAHR hat gewonnen — genau der gemeldete Fehler.');
  assert.equal(setnummerKandidaten('LEGO Star Wars Millennium Falcon 75192 7541 Teile')[0], '75192',
    'Die Teilezahl hat gewonnen.');
  assert.equal(setnummerKandidaten('LEGO Technic 42115 Lamborghini Sián 3696 Pcs')[0], '42115');
});

test('eine Raute weist die Artikelnummer aus', () => {
  const k = setnummerKandidaten('LEGO Creator 3696 Steine #31142');
  assert.equal(k[0], '31142', `Reihenfolge falsch: ${JSON.stringify(k)}`);
});

test('ein Jahr bleibt, wenn es der einzige Kandidat ist', () => {
  // Lieber ein unsicherer Kandidat als gar keiner: Vierstellige Setnummern in
  // diesem Bereich gibt es wirklich. Der Katalogabgleich in der Route
  // entscheidet danach, und die Antwort ist ohnehin als Vermutung markiert.
  assert.deepEqual(setnummerKandidaten('LEGO 1978'), ['1978']);
});

test('Mengenangaben fallen raus, auch mit x davor', () => {
  assert.deepEqual(setnummerKandidaten('Konvolut 1250 pieces'), []);
  assert.deepEqual(setnummerKandidaten('Bundle x 2500 bricks'), []);
});

test('siebenstellige Bestellnummern werden gesehen', () => {
  // Die alte Fassung ging nur bis sechs Stellen.
  assert.ok(setnummerKandidaten('LEGO Bestellnr 6284070').includes('6284070'));
});
