/**
 * If reading the price alerts fails, the error arrives, not an empty list:
 * empty would mean „no alert“, the app would advance its marker, and setzeAlarm()
 * would return nothing after writing.
 *
 * Counter-checks (measured 14.11.2026), each again `.catch(e => { reportError(…); return []; })`:
 *   A  in allAlerts() → red: “all alerts” (Missing expected rejection)
 *   B  in triggeredSince() → red: “triggered alerts since …”
 *   C  in alertsFor() → red: “setzeAlarm …” (undefined instead of an error)
 *   D  in checkSet() → red: “the price run …” (0 instead of an error)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testServices, testData, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

function replace(rel, fields) {
  const p = require.resolve(path.join(ROOT, 'dist', rel));
  const original = require(p);
  require.cache[p].exports = Object.assign({}, original, fields);
}
const disrupted = async () => {
  throw new Error('Tabelle gestört');
};
replace('src/finances/repository/priceAlerts.js', {
  alertsOfSets: disrupted,
  alertsInScope: disrupted,
  alertsOfAccount: disrupted,
  allActiveAlerts: disrupted,
});

test('price alerts: a read error is not an empty list', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const db = testData();
  const name = `pal_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const p = testServices().finances.priceAlert;
  const SN = `92${String(process.pid).slice(-4)}-1`;

  await t.test('all alerts', () => assert.rejects(p.allAlerts(uid), /Tabelle gestört/));
  await t.test('triggered alerts since a marker', () =>
    assert.rejects(p.triggeredSince(uid, new Date(0)), /Tabelle gestört/),
  );
  await t.test('setzeAlarm reads after writing', () =>
    assert.rejects(
      asAccount(uid, () => p.setAlert(uid, SN, 'EUR', { direction: 'below', threshold: 10, condition: 'N' })),
      /Tabelle gestört/,
    ),
  );
  await t.test('the price run sees the error', () =>
    assert.rejects(
      _req('src/finances/priceAlert.js').checkSet(SN, { buildAlertMail: () => ({}), sendMail: async () => ({}) }),
      /Tabelle gestört/,
    ),
  );
});
