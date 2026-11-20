/**
 * Scheitert das Lesen der Preisalarme, kommt der Fehler an, keine leere Liste:
 * Leer hiesse „kein Alarm“, die App rückte ihre Marke vor, und setzeAlarm()
 * lieferte nach dem Schreiben nichts zurück.
 *
 * Gegenproben (14.11.2026 gemessen), je wieder `.catch(e => { reportError(…); return []; })`:
 *   A  in alleAlarme() → rot: „alle Alarme“ (Missing expected rejection)
 *   B  in triggeredSince() → rot: „ausgelöste Alarme seit …“
 *   C  in alertsFor() → rot: „setzeAlarm …“ (undefined statt Fehler)
 *   D  in checkSet() → rot: „der Preislauf …“ (0 statt Fehler)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testServices, testData, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

function replace(rel, felder) {
  const p = require.resolve(path.join(ROOT, 'dist', rel));
  const echt = require(p);
  require.cache[p].exports = Object.assign({}, echt, felder);
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
  const p = testServices().finances.preisalarm;
  const SN = `92${String(process.pid).slice(-4)}-1`;

  await t.test('all alerts', () => assert.rejects(p.alleAlarme(uid), /Tabelle gestört/));
  await t.test('triggered alerts since a marker', () =>
    assert.rejects(p.triggeredSince(uid, new Date(0)), /Tabelle gestört/),
  );
  await t.test('setzeAlarm reads after writing', () =>
    assert.rejects(
      asAccount(uid, () => p.setzeAlarm(uid, SN, 'EUR', { direction: 'unter', threshold: 10, condition: 'N' })),
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
