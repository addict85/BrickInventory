/**
 * Klienten kennen keinen Fachbereich: Schlüssel, Kontingent und Drossel kommen
 * über clients/zugang.ts, eingesetzt von src/katalog/quellen.ts.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in clients/zugang.ts liefert OHNE.schluessel 'x' statt '' → rot:
 *      „ohne Verdrahtung geht nichts hinaus“ (ein Abruf mit `key x`)
 *   B  in src/katalog/quellen.ts `schluessel: async () => ''` → rot: „über
 *      quellen.ts tragen Abrufe den eingetragenen Schlüssel und zählen“
 *   C  in src/katalog/quellen.ts `zaehle: async () => ({ allowed: true, count: 0,
 *      limit: 0 })` → rot: derselbe Test (der Zähler bleibt stehen)
 *
 * Rebrickable selbst wird nicht gefragt: https.get ist eine Attrappe.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();

/** @type {{ pfad: string, schluessel: string | undefined }[]} */
const abrufe = [];
// @ts-ignore — Attrappe mit genau dem, was src/infra/abruf.ts benutzt.
https.get = (url, opts, cb) => {
  const u = new URL(url);
  abrufe.push({ pfad: u.pathname, schluessel: opts?.headers?.Authorization });
  const req = new EventEmitter();
  setImmediate(() => cb(Object.assign(Readable.from([JSON.stringify({ name: 'Attrappe' })]), { statusCode: 200, headers: {} })));
  return req;
};

test('ohne Verdrahtung geht nichts hinaus', async () => {
  const rb = _req('clients/rebrickable.js');
  assert.equal(await rb.rebrickableJson('/lego/sets/10001-1/'), null);
  assert.deepEqual(abrufe, []);
});

test('über quellen.ts tragen Abrufe den eingetragenen Schlüssel und zählen', { concurrency: 1 }, async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const { setGlobalSetting, deleteGlobalSetting } = _req('src/einstellungen/settings.js');
  await setGlobalSetting('rebrickable_api_key', 'schluessel-zugang-1');
  t.after(async () => { await deleteGlobalSetting('rebrickable_api_key'); await db.pool.end().catch(() => {}); });
  const heute = new Date().toISOString().slice(0, 10);
  const zaehler = async () => Number((await db.get(
    "SELECT anzahl FROM api_aufrufe WHERE tag = $1 AND api = 'rebrickable' AND konto = 0", [heute]))?.anzahl || 0);
  const vorher = await zaehler();

  const { rebrickableJson } = _req('src/katalog/quellen.js');
  assert.deepEqual(await rebrickableJson('/lego/sets/10001-1/'), { name: 'Attrappe' });
  assert.deepEqual(abrufe, [{ pfad: '/api/v3/lego/sets/10001-1/', schluessel: 'key schluessel-zugang-1' }]);
  assert.equal(await zaehler(), vorher + 1);
});
