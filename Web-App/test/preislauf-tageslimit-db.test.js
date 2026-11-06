/**
 * Preislauf bei aufgebrauchtem BrickLink-Kontingent: eine Zeile im Protokoll
 * statt einer je Set, und die übrigen Sets fragen gar nicht erst nach.
 *
 * Gegenprobe (06.11.2026): jobs/priceJob.ts auf den Stand vor der Änderung
 * (Meldung in fetchAndCachePrice() je Aufruf, kein Abbruch nach dem ersten
 * Treffer) → rot: „eine Zeile statt einer je Set“ (6 Zeilen) und „die
 * Abschlusszeile nennt die ausgelassenen Sets“.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');

test('Preislauf am Tageslimit', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { setGlobalSetting } = _req('src/einstellungen/settings.js');
  const { checkAndIncrementRateLimit } = _req('src/katalog/apiKontingent.js');
  const { runPriceRefresh } = _req('jobs/priceJob.js');

  const uid = (
    await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [`ptl_${process.pid}`])
  ).id;
  for (const sn of ['10305-1', '21318-1', '75192-1']) await haeltSet(db, uid, sn);
  await setGlobalSetting('bricklink_consumer_key', 'schluessel');
  await setGlobalSetting('api_limit_bricklink', '1');
  await checkAndIncrementRateLimit('bricklink');

  const zeilen = [];
  t.mock.method(console, 'log', (...teile) => {
    zeilen.push(teile.join(' '));
  });
  await runPriceRefresh();
  t.mock.restoreAll();

  await t.test('eine Zeile statt einer je Set', () => {
    assert.equal(zeilen.filter(z => /Tageslimit erreicht/.test(z)).length, 1, zeilen.join('\n'));
  });
  await t.test('die Abschlusszeile nennt die ausgelassenen Sets', () => {
    const ende = zeilen.find(z => z.includes('Done:')) ?? '';
    assert.match(ende, /0 errors, [3-9]\d* wegen Tageslimit ausgelassen/, ende);
  });
});
