/**
 * Datumsangaben aus CSV-Dateien.
 *
 * `new Date('05.03.2026')` liefert den **3. Mai**, nicht den 5. März —
 * JavaScript liest punktgetrennte Daten amerikanisch als MM.DD.YYYY. Dasselbe
 * gilt für Postgres bei DateStyle MDY. Eine Datei mit Schweizer Datumsangaben
 * landete dadurch mit vertauschten Tagen und Monaten in der Datenbank, und bei
 * Tagen über 12 scheiterte der Import ganz.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// utils/csvExport ist TypeScript; das ladbare .js liegt seit der Umstellung
// in dist/ und nicht mehr neben der Quelle. buildAndRequire() baut bei Bedarf
// und löst dorthin auf.
const { parseCsvDate } = require('./helpers/sources').buildAndRequire()('utils/csvExport.js');

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

test('beide Importe benutzen den Parser', () => {
  // Vorher stand in beiden ein blosses .trim() — der Wert ging roh weiter.
  for (const f of ['sets.ts', 'parts.ts']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', f), 'utf8');
    assert.match(src, /const acquiredAt = parseCsvDate\(/,
      `${f}: Der Importpfad muss parseCsvDate benutzen`);
    assert.doesNotMatch(src, /const acquiredAt = \(row\.acquired_at/,
      `${f}: rohe Übernahme ohne Umwandlung`);
  }
});
