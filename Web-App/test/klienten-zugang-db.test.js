/**
 * Klienten kennen keinen Fachbereich und keinen Prozess-Speicher: Schlüssel,
 * Kontingent und Drossel bekommt jeder Klient bei seiner Erzeugung
 * (createRebrickable(z) …), src/fremdquellen gibt sie ihm aus seinem Zugang.
 *
 * Gegenproben (am 14.11.2026 gemessen):
 *   A  in clients/rebrickable.ts ein modulweites `let _z` gesetzt von jedem
 *      createRebrickable(z) und in getRbKey() statt `z` gelesen (der frühere
 *      verdrahteKlienten(): der letzte gewinnt) → rot: „zwei Klienten …“
 *      (beide Abrufe trugen „key zweiter“)
 *   B  in createForeignSources() `schluessel: async () => ''` → rot: „über die
 *      Dienste tragen Abrufe …“ (kein Abruf, Ergebnis null)
 *   C  in createForeignSources() `zaehle: async () => ({ allowed: true, count: 0,
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
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

/** @type {{ pfad: string, schluessel: string | undefined }[]} */
const fetches = [];
// @ts-expect-error — Attrappe mit genau dem, was src/infra/abruf.ts benutzt.
https.get = (url, opts, cb) => {
  const u = new URL(url);
  fetches.push({ pfad: u.pathname, schluessel: /** @type {any} */ (opts)?.headers?.Authorization });
  const req = new EventEmitter();
  setImmediate(() =>
    cb(
      /** @type {any} */ (
        Object.assign(Readable.from([JSON.stringify({ set_num: '10001-1', name: 'Attrappe' })]), {
          statusCode: 200,
          headers: {},
        })
      ),
    ),
  );
  return req;
};

/** Ein Zugang ohne Datenbank: fester Schlüssel, freies Kontingent, Drossel ohne Warten. */
const accessWith = schluessel => {
  const frei = { waitForSlot: async () => {}, throttle: () => {} };
  return {
    schluessel: async () => schluessel,
    zaehle: async () => ({ allowed: true, count: 1, limit: 10 }),
    quotaStatus: async () => ({ count: 1, limit: 10, remaining: 9 }),
    drossel: { foreground: frei, hintergrund: frei },
    bricksetReserve: async () => ({ versuch: 1, vorgemerkt: true, hoechstens: 3 }),
    bricksetForgotten: async () => {},
  };
};

test('zwei Klienten in einem Prozess fragen jeder mit dem Schlüssel ihres Zugangs', async () => {
  const { createRebrickable } = _req('clients/rebrickable.js');
  const { RbSet } = _req('clients/antworten.js');
  const erster = createRebrickable(accessWith('erster'));
  const zweiter = createRebrickable(accessWith('zweiter'));
  fetches.length = 0;
  await erster.rebrickableJson('/lego/sets/10001-1/', RbSet);
  await zweiter.rebrickableJson('/lego/sets/10001-1/', RbSet);
  assert.deepEqual(
    fetches.map(a => a.schluessel),
    ['key erster', 'key zweiter'],
  );
});

test('über die Dienste tragen Abrufe den eingetragenen Schlüssel und zählen', { concurrency: 1 }, async t => {
  const db = S.testData();
  if (!(await dataOrSkip(t, _req))) return;
  const { setGlobalSetting, deleteGlobalValues } = _req('src/settings/settings.js');
  await setGlobalSetting('rebrickable_api_key', 'schluessel-zugang-1');
  t.after(async () => {
    await deleteGlobalValues('rebrickable_api_key');
    await db.pool.end().catch(() => {});
  });
  const heute = new Date().toISOString().slice(0, 10);
  const zaehler = async () =>
    Number(
      (await db.get("SELECT count FROM api_calls WHERE day = $1 AND api = 'rebrickable' AND account_id = 0", [heute]))
        ?.count || 0,
    );
  const vorher = await zaehler();

  const { RbSet } = _req('src/fremdquellen/index.js');
  fetches.length = 0;
  const antwort = await S.testServices().fremdquellen.quellen.rebrickableJson('/lego/sets/10001-1/', RbSet);
  assert.deepEqual(antwort, { set_num: '10001-1', name: 'Attrappe' });
  assert.deepEqual(fetches, [{ pfad: '/api/v3/lego/sets/10001-1/', schluessel: 'key schluessel-zugang-1' }]);
  assert.equal(await zaehler(), vorher + 1);
});
