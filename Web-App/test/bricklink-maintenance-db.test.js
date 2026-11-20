/**
 * BrickLink in Wartung: Jede API-Anfrage wird auf maintenance.bricklink.com
 * umgeleitet. Der Klient meldet das als eigenen Fehler, und der Preislauf hört
 * nach dem ersten Treffer auf, statt jedes Set einzeln scheitern zu lassen.
 *
 * Gegenproben (06.11.2026):
 *   A  in bricklinkRequest() die Prüfung auf 3xx gestrichen → rot: „eine
 *      Umleitung ist ‚nicht erreichbar‘“ (BrickLink non-JSON (HTTP 302))
 *   B  in fetchAndCachePrice() den Zweig für BricklinkNotReachable gestrichen
 *      → rot: „der Preislauf meldet es einmal“ (eine Error-Zeile je Set)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

const MAINTENANCE = 'https://maintenance.bricklink.com:443/recovery.html';

/** Jede Anfrage an BrickLink antwortet wie während der Wartung. */
function maintenanceFake(t) {
  const aufrufe = [];
  t.mock.method(https, 'get', (url, _o, atResponse) => {
    aufrufe.push(String(url));
    const anfrage = Object.assign(new EventEmitter(), { destroy() {} });
    const antwort = Object.assign(new PassThrough(), { statusCode: 302, headers: { location: MAINTENANCE } });
    setImmediate(() => {
      atResponse(antwort);
      antwort.end();
    });
    return anfrage;
  });
  return aufrufe;
}

test('BrickLink in maintenance', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { createBricklink, BricklinkNotReachable } = _req('clients/bricklink.js');
  const { setGlobalSetting } = _req('src/settings/settings.js');
  const { runPriceRefresh } = _req('src/finances/priceRun.js');

  // Ein Klient mit allen vier Schlüsseln und freiem Kontingent, gestellt an der Verdrahtung.
  const { bricklinkRequest } = createBricklink({
    async schluessel() {
      return 'x';
    },
    async zaehle() {
      return { allowed: true, count: 0, limit: 4000 };
    },
  });
  testSources(t, { bricklinkRequest });
  maintenanceFake(t);

  await t.test('a redirect is "not reachable"', async () => {
    await assert.rejects(bricklinkRequest('GET', '/items/set/10305-1/price'), (/** @type {Error} */ e) => {
      assert.ok(e instanceof BricklinkNotReachable, String(e?.message));
      assert.ok(e.message.includes('nach maintenance.bricklink.com'), e.message);
      return true;
    });
  });

  await t.test('the price run reports it once', async () => {
    const uid = (
      await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [`blw_${process.pid}`])
    ).id;
    for (const sn of ['10305-1', '21318-1', '75192-1']) await holdsSet(db, uid, sn);
    await setGlobalSetting('bricklink_consumer_key', 'schluessel');
    const zeilen = [];
    t.mock.method(console, 'log', (...teile) => {
      zeilen.push(teile.join(' '));
    });
    await runPriceRefresh();
    t.mock.restoreAll();
    assert.equal(zeilen.filter(z => /nicht erreichbar \(Wartung\)/.test(z)).length, 1, zeilen.join('\n'));
    assert.equal(zeilen.filter(z => /Error /.test(z)).length, 0, zeilen.join('\n'));
    assert.match(zeilen.find(z => z.includes('Done:')) ?? '', /wegen BrickLink nicht erreichbar ausgelassen/);
  });
});
