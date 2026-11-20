/**
 * Das Laden von jobs/auftraegeStarten.ts setzt nichts im Prozess; den Pfad des
 * Import-Prozesses reicht die Bearbeitertabelle dem Katalogabgleich herein.
 *
 * Gegenprobe (15.11.2026 gemessen): in startup/verdrahtung.ts
 * `d.catalog.auftragsarten('')` statt des Pfads → rot: „der Katalogabgleich bekommt den Import-Prozess“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAndRequire, ROOT } = require('./helpers/sources');

buildAndRequire();
const { editor } = require(path.join(ROOT, 'dist/jobs/auftraegeStarten.js'));

test('der Katalogabgleich bekommt den Import-Prozess', async () => {
  const aufrufe = [];
  // Vor dem Laden der Verdrahtung ersetzt: Die Anmeldung des Katalogs ruft das Modul.
  const modul = require.resolve(path.join(ROOT, 'dist/src/catalog/csvSync.js'));
  const echt = require(modul);
  require.cache[modul].exports = { ...echt, csvAbgleich: async (...a) => aufrufe.push(a) };
  const stummel = { inTransaction: () => false, transaction: async () => {} };
  const d = require(path.join(ROOT, 'dist/startup/verdrahtung.js')).buildServices(stummel);
  await editor(d).csv_sync.ausfuehren({ onStart: true }, {});
  const pfad = aufrufe[0]?.[3];
  assert.match(String(pfad), /[\\/]jobs[\\/]csvImportWorker\.js$/);
  assert.ok(fs.existsSync(pfad), `${pfad} fehlt`);
});
