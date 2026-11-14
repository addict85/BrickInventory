/**
 * Das Laden von jobs/auftraegeStarten.ts setzt nichts im Prozess; den Pfad des
 * Import-Prozesses reicht die Bearbeitertabelle dem Katalogabgleich herein.
 *
 * Gegenprobe (14.11.2026 gemessen): in der Tabelle wieder
 * `csv_sync: … d.katalog.csvAbgleich(n, k)` (Pfad über einen gesetzten Wert) →
 * rot: „der Katalogabgleich bekommt den Import-Prozess“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAndRequire, ROOT } = require('./helpers/sources');

buildAndRequire();
const { bearbeiter } = require(path.join(ROOT, 'dist/jobs/auftraegeStarten.js'));

test('der Katalogabgleich bekommt den Import-Prozess', async () => {
  const aufrufe = [];
  const d = { katalog: { csvAbgleich: async (...a) => aufrufe.push(a) } };
  await bearbeiter(d).csv_sync.ausfuehren({ beimStart: true }, {});
  const pfad = aufrufe[0]?.[2];
  assert.match(String(pfad), /[\\/]jobs[\\/]csvImportWorker\.js$/);
  assert.ok(fs.existsSync(pfad), `${pfad} fehlt`);
});
