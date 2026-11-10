/**
 * Datumsangaben aus CSV-Dateien.
 * Ausführlich: docs/begruendungen/test/csv-date.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
// src/infra/csvExport ist TypeScript; das ladbare .js liegt seit der Umstellung
// in dist/ und nicht mehr neben der Quelle. buildAndRequire() baut bei Bedarf
// und löst dorthin auf.
const { parseCsvDate } = require('./helpers/sources').buildAndRequire()('src/infra/csvExport.js');

test('Tag zuerst, nicht Monat', () => {
  assert.equal(parseCsvDate('05.03.2026'), '2026-03-05', '5. März, nicht 3. Mai');
  assert.equal(parseCsvDate('25.12.2025'), '2025-12-25');
  assert.equal(parseCsvDate('05/03/2026'), '2026-03-05', 'auch mit Schrägstrich');
  // Genau der Fall, der vorher zu einem Fehler führte: Tag > 12
  assert.equal(parseCsvDate('31.12.2025'), '2025-12-31');
});

test('ISO bleibt ISO', () => {
  // Das eigene Exportformat — es darf nicht als Tag-zuerst umgedeutet werden.
  assert.equal(parseCsvDate('2026-03-05'), '2026-03-05');
});

test('zweistellige Jahre', () => {
  assert.equal(parseCsvDate('05.03.26'), '2026-03-05');
  assert.equal(parseCsvDate('05.03.99'), '1999-03-05');
});

test('unmögliche Daten werden abgelehnt', () => {
  // Eine Prüfung auf 1–31 allein liesse den 31. Februar durch; Date rollt ihn
  // still in den März.
  assert.equal(parseCsvDate('31.02.2026'), null);
  assert.equal(parseCsvDate('29.02.2025'), null, '2025 ist kein Schaltjahr');
  assert.equal(parseCsvDate('29.02.2024'), '2024-02-29', '2024 schon');
  assert.equal(parseCsvDate('00.03.2026'), null);
  assert.equal(parseCsvDate('05.13.2026'), null);
});

test('leere und unbrauchbare Eingaben ergeben null', () => {
  for (const v of ['', '   ', 'abc', null, undefined]) {
    assert.equal(parseCsvDate(v), null, `${JSON.stringify(v)} muss null ergeben`);
  }
});

// Geprüft wird jeder Import, nicht eine aufgezählte Liste: Ein Import, der in
// keiner Liste steht, wird sonst von niemandem geprüft.
// Ausführlich: docs/begruendungen/test/csv-date.test.js.md#stelle

/**
 * Jeder CSV-Import läuft durch parseCsvDate — nicht nur die, an die jemand dachte.
 * Ausführlich: docs/begruendungen/test/csv-date.test.js.md#jeder-csv-import-normalisiert-das-datum
 *
 * Gegenprobe (29.10.2026): parseCsvDate in setCsvZeilen weggelassen → rot.
 */
test('jeder CSV-Import normalisiert das Datum', () => {
  const _req = require('./helpers/sources').buildAndRequire();
  const { setCsvZeilen } = _req('src/sets/dienst.js');
  const { csvGemeinsameFelder } = _req('src/infra/csvExport.js');
  const { rows } = setCsvZeilen('set_number;acquired_at\n10001-1;01.02.2026\n');
  assert.equal(rows[0].acquiredAt, '2026-02-01', 'Sets: 01.02.2026 ist der 1. Februar');
  assert.equal(csvGemeinsameFelder({ acquired_at: '01.02.2026' }).erfasstAm, '2026-02-01',
    'Teile und Figuren: 01.02.2026 ist der 1. Februar');
  assert.equal(csvGemeinsameFelder({ erfassungsdatum: '31.02.2026' }).erfasstAm, null,
    'ein unmögliches Datum wird verworfen statt an die Datenbank gereicht');
});
