/**
 * Scheitert der Katalogabgleich beim Start (kein Netz), meldet der Server
 * trotzdem „bereit“ — sonst bleibt der Startbildschirm stehen.
 *
 * Gegenprobe (am 28.10.2026 gemessen): die Bereitmeldung im catch-Zweig von
 * run() entfernt → rot: „ohne Netz ist der Server trotzdem bereit“.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

// Jeder Abruf scheitert sofort — wie ein Rechner ohne Netz.
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (name === 'https') return { ...m, get: () => {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    setImmediate(() => req.emit('error', new Error('getaddrinfo ENOTFOUND cdn.rebrickable.com')));
    return req;
  } };
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Katalogabgleich ohne Netz', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const vorher = (await db.get(`SELECT value FROM global_settings WHERE key='rb_csv_last_sync'`))?.value ?? null;
  await db.run(`DELETE FROM global_settings WHERE key IN ('rb_csv_last_sync','startup_status')`);
  global.startupStatus = { ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 };
  try {
    await t.test('ohne Netz ist der Server trotzdem bereit', async () => {
      await _req('jobs/rebrickableCsvSync.js').run();
      assert.equal(global.startupStatus.ready, true, JSON.stringify(global.startupStatus));
      const gespeichert = JSON.parse((await db.get(`SELECT value FROM global_settings WHERE key='startup_status'`)).value);
      assert.equal(gespeichert.ready, true, 'die anderen Worker lesen den Stand aus der Datenbank');
    });
  } finally {
    if (vorher !== null) await db.run(`INSERT INTO global_settings (key,value) VALUES ('rb_csv_last_sync',$1)
                                       ON CONFLICT (key) DO UPDATE SET value=$1`, [vorher]);
    await db.pool.end().catch(() => {});
  }
});
