/**
 * If the catalog sync fails at startup (no network), the server still
 * reports “ready” — otherwise the startup screen stays.
 *
 * Counter-check (measured on 28.10.2026): the ready report removed in the catch branch of
 * run() → red: “without network the server is still ready”.
 * Counter-check (30.10.2026): `throw e` in the catch branch replaced by `return` →
 * red: the same test (“Missing expected rejection”) — the job would consider the
 * failed sync done and retry it only the next day.
 *
 * Counter-check (09.11.2026): in runWorker() the unlink taken out of the finally branch → red:
 *   “the temporary file does not stay after a failure” (colors.csv.tmp stayed).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Every fetch fails immediately — like a computer without network.
const Module = require('node:module');
const _realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _realRequire.call(this, name, ...rest);
  if (name.replace(/^node:/, '') === 'https')
    return {
      ...m,
      get: () => {
        const req = /** @type {any} */ (new EventEmitter());
        req.setTimeout = () => req;
        setImmediate(() => req.emit('error', new Error('getaddrinfo ENOTFOUND cdn.rebrickable.com')));
        return req;
      },
    };
  return m;
};

const { buildAndRequire, testData, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const fs = require('node:fs');
const path = require('node:path');

// With `tempFile` the download creates the file and succeeds; the import afterwards does not exist here.
let tempFile = false;
const echt = _req('clients/rebrickableCsv.js');
testSources(null, {
  loadCatalogCsv: async (datei, ziel, o) => {
    if (!tempFile) return echt.loadCatalogCsv(datei, ziel, o);
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    fs.writeFileSync(ziel, 'id,name\n1,Rot\n');
  },
});

test('catalog reconciliation without network', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const vorher = (await db.get(`SELECT value FROM run_state WHERE key='rb_csv_last_sync'`))?.value ?? null;
  await db.run(`DELETE FROM run_state WHERE key IN ('rb_csv_last_sync','startup_status')`);
  const condition = _req('src/jobQueue/startState.js');
  await condition.reportStartState({ ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 });
  try {
    await t.test('without network the server is ready anyway', async () => {
      await assert.rejects(_req('src/catalog/csvSync.js').run(), 'der Auftrag soll den Fehler sehen und wiederholen');
      const state = await condition.currentStartState();
      assert.equal(state.ready, true, JSON.stringify(state));
      const gespeichert = JSON.parse((await db.get(`SELECT value FROM run_state WHERE key='startup_status'`)).value);
      assert.equal(gespeichert.ready, true, 'die anderen Worker lesen den Stand aus der Datenbank');
    });
    await t.test('the temporary file does not stay behind after a failure', async () => {
      const tmp = path.join(_req('src/infra/appPaths.js').DATA_DIR, 'colors.csv.tmp');
      tempFile = true;
      try {
        await assert.rejects(_req('src/catalog/csvSync.js').run());
      } finally {
        tempFile = false;
      }
      assert.equal(fs.existsSync(tmp), false, `${tmp} liegt noch da`);
    });
  } finally {
    if (vorher !== null)
      await db.run(
        `INSERT INTO run_state (key, value) VALUES ('rb_csv_last_sync',$1)
                                       ON CONFLICT (key) DO UPDATE SET value = $1`,
        [vorher],
      );
    await db.pool.end().catch(() => {});
  }
});
