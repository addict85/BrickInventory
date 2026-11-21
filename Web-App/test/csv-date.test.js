/**
 * Dates from CSV files.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
// src/infra/csvExport is TypeScript; since the conversion the loadable .js lives
// in dist/ and no longer next to the source. buildAndRequire() builds when needed
// and resolves to there.
const { csvDatum } = require('./helpers/sources').buildAndRequire()('src/infra/csvExport.js');

test('day first, not month', () => {
  assert.equal(csvDatum('05.03.2026'), '2026-03-05', '5. März, nicht 3. Mai');
  assert.equal(csvDatum('25.12.2025'), '2025-12-25');
  assert.equal(csvDatum('05/03/2026'), '2026-03-05', 'auch mit Schrägstrich');
  // Exactly the case that used to lead to an error: day > 12
  assert.equal(csvDatum('31.12.2025'), '2025-12-31');
});

test('ISO stays ISO', () => {
  // The own export format — it must not be reinterpreted as day-first.
  assert.equal(csvDatum('2026-03-05'), '2026-03-05');
});

test('two-digit years', () => {
  assert.equal(csvDatum('05.03.26'), '2026-03-05');
  assert.equal(csvDatum('05.03.99'), '1999-03-05');
});

test('impossible dates are rejected', () => {
  // A check for 1–31 alone would let 31 February through; Date silently rolls it
  // into March.
  assert.equal(csvDatum('31.02.2026'), null);
  assert.equal(csvDatum('29.02.2025'), null, '2025 ist kein Schaltjahr');
  assert.equal(csvDatum('29.02.2024'), '2024-02-29', '2024 schon');
  assert.equal(csvDatum('00.03.2026'), null);
  assert.equal(csvDatum('05.13.2026'), null);
});

test('empty and unusable inputs yield null', () => {
  for (const v of ['', '   ', 'abc', null, undefined]) {
    assert.equal(csvDatum(v), null, `${JSON.stringify(v)} muss null ergeben`);
  }
});

// Every import is checked, not an enumerated list: an import that is in
// no list is otherwise checked by nobody.

/**
 * Every CSV import runs through csvDatum — not only the ones someone thought of.
 *
 * Counter-check (29.10.2026): csvDatum omitted in setCsvRows → red.
 */
test('every CSV import normalizes the date', () => {
  const _req = require('./helpers/sources').buildAndRequire();
  const { setCsvRows } = require('./helpers/sources').areaPage('sets');
  const { csvSharedFields } = _req('src/infra/csvExport.js');
  const { rows } = setCsvRows('set_number;acquired_at\n10001-1;01.02.2026\n');
  assert.equal(rows[0].acquiredAt, '2026-02-01', 'Sets: 01.02.2026 ist der 1. Februar');
  assert.equal(
    csvSharedFields({ acquired_at: '01.02.2026' }).recordedAt,
    '2026-02-01',
    'Teile und Figuren: 01.02.2026 ist der 1. Februar',
  );
  assert.equal(
    csvSharedFields({ erfassungsdatum: '31.02.2026' }).recordedAt,
    null,
    'ein unmögliches Datum wird verworfen statt an die Datenbank gereicht',
  );
});
