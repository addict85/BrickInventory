/**
 * BrickLink in Wartung: Jede API-Anfrage wird auf maintenance.bricklink.com
 * umgeleitet. Der Klient meldet das als eigenen Fehler, und der Preislauf hört
 * nach dem ersten Treffer auf, statt jedes Set einzeln scheitern zu lassen.
 *
 * Gegenproben (06.11.2026):
 *   A  in bricklinkRequest() die Prüfung auf 3xx gestrichen → rot: „eine
 *      Umleitung ist ‚nicht erreichbar‘“ (BrickLink non-JSON (HTTP 302))
 *   B  in fetchAndCachePrice() den Zweig für BricklinkNichtErreichbar gestrichen
 *      → rot: „der Preislauf meldet es einmal“ (eine Error-Zeile je Set)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');

const WARTUNG = 'https://maintenance.bricklink.com:443/recovery.html';

/** Jede Anfrage an BrickLink antwortet wie während der Wartung. */
function wartungVortaeuschen(t) {
  const aufrufe = [];
  t.mock.method(https, 'get', (url, _o, beiAntwort) => {
    aufrufe.push(String(url));
    const anfrage = Object.assign(new EventEmitter(), { destroy() {} });
    const antwort = Object.assign(new PassThrough(), { statusCode: 302, headers: { location: WARTUNG } });
    setImmediate(() => {
      beiAntwort(antwort);
      antwort.end();
    });
    return anfrage;
  });
  return aufrufe;
}

test('BrickLink in Wartung', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { verdrahteKlienten, zugang } = _req('clients/zugang.js');
  const { bricklinkRequest, BricklinkNichtErreichbar } = _req('clients/bricklink.js');
  const { setGlobalSetting } = _req('src/einstellungen/settings.js');
  const { runPriceRefresh } = _req('src/finanzen/preisLauf.js');

  const vorher = zugang();
  verdrahteKlienten({
    ...vorher,
    async schluessel() {
      return 'x';
    },
    async zaehle() {
      return { allowed: true, count: 0, limit: 4000 };
    },
  });
  t.after(() => verdrahteKlienten(vorher));
  wartungVortaeuschen(t);

  await t.test('eine Umleitung ist „nicht erreichbar“', async () => {
    await assert.rejects(bricklinkRequest('GET', '/items/set/10305-1/price'), (/** @type {Error} */ e) => {
      assert.ok(e instanceof BricklinkNichtErreichbar, String(e?.message));
      assert.ok(e.message.includes('nach maintenance.bricklink.com'), e.message);
      return true;
    });
  });

  await t.test('der Preislauf meldet es einmal', async () => {
    const uid = (
      await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [`blw_${process.pid}`])
    ).id;
    for (const sn of ['10305-1', '21318-1', '75192-1']) await haeltSet(db, uid, sn);
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
