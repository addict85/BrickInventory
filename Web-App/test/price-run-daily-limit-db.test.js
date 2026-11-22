/**
 * Price run with an exhausted BrickLink quota: one line in the log
 * instead of one per set, and the remaining sets do not even ask.
 *
 * Counter-check (06.11.2026): src/finances/priceRun.ts at the state before the change
 * (message in fetchAndCachePrice() per call, no abort after the first
 * hit) → red: “one line instead of one per set” (6 lines) and “the
 * closing line names the skipped sets”.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test('price run at the daily limit', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { setGlobalSetting } = _req('src/settings/settings.js');
  const { checkAndCountQuota } = _req('src/externalSources/apiQuota.js');
  const { runPriceRefresh } = _req('src/finances/priceRun.js');

  const uid = (
    await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [`ptl_${process.pid}`])
  ).id;
  for (const sn of ['10305-1', '21318-1', '75192-1']) await holdsSet(db, uid, sn);
  await setGlobalSetting('bricklink_consumer_key', 'schluessel');
  await setGlobalSetting('api_limit_bricklink', '1');
  await checkAndCountQuota('bricklink');

  const zeilen = [];
  t.mock.method(console, 'log', (...parts) => {
    zeilen.push(parts.join(' '));
  });
  await runPriceRefresh();
  t.mock.restoreAll();

  await t.test('one line instead of one per set', () => {
    assert.equal(zeilen.filter(z => /Tageslimit erreicht/.test(z)).length, 1, zeilen.join('\n'));
  });
  await t.test('the closing line names the skipped sets', () => {
    const ende = zeilen.find(z => z.includes('Done:')) ?? '';
    assert.match(ende, /0 errors, [3-9]\d* wegen Tageslimit ausgelassen/, ende);
  });
});
