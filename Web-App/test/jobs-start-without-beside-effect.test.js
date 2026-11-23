/**
 * Loading jobs/startJobs.ts sets nothing in the process; the path of the
 * import process is handed into the catalog sync by the handler table.
 *
 * Counter-check (measured 15.11.2026): in startup/wiring.ts
 * `d.catalog.jobKinds('')` instead of the path → red: “the catalog sync gets the import process”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAndRequire, ROOT } = require('./helpers/sources');

buildAndRequire();
const { editor } = require(path.join(ROOT, 'dist/jobs/startJobs.js'));

test('the catalog reconciliation gets the import process', async () => {
  const calls = [];
  // Replaced before loading the wiring: the catalog's registration calls the module.
  const mod = require.resolve(path.join(ROOT, 'dist/src/catalog/csvSync.js'));
  const original = require(mod);
  require.cache[mod].exports = { ...original, csvReconcile: async (...a) => calls.push(a) };
  const stummel = { inTransaction: () => false, transaction: async () => {} };
  const d = require(path.join(ROOT, 'dist/startup/wiring.js')).buildServices(stummel);
  await editor(d).csv_sync.run({ onStart: true }, {});
  const workerPath = calls[0]?.[3];
  assert.match(String(workerPath), /[\\/]jobs[\\/]csvImportWorker\.js$/);
  assert.ok(fs.existsSync(workerPath), `${path} is missing`);
});
