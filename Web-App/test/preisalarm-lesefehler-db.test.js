/**
 * Scheitert das Lesen der Preisalarme, kommt der Fehler an, keine leere Liste:
 * Leer hiesse „kein Alarm“, die App rückte ihre Marke vor, und setzeAlarm()
 * lieferte nach dem Schreiben nichts zurück.
 *
 * Gegenproben (14.11.2026 gemessen), je wieder `.catch(e => { meldeFehler(…); return []; })`:
 *   A  in alleAlarme() → rot: „alle Alarme“ (Missing expected rejection)
 *   B  in ausgeloesteSeit() → rot: „ausgelöste Alarme seit …“
 *   C  in alarmeFuer() → rot: „setzeAlarm …“ (undefined statt Fehler)
 *   D  in pruefeSet() → rot: „der Preislauf …“ (0 statt Fehler)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testDienste, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

function ersetze(rel, felder) {
  const p = require.resolve(path.join(ROOT, 'dist', rel));
  const echt = require(p);
  require.cache[p].exports = Object.assign({}, echt, felder);
}
const gestoert = async () => {
  throw new Error('Tabelle gestört');
};
ersetze('src/finanzen/repository/preisalarme.js', {
  alarmeDesSets: gestoert,
  alarmeImBlickfeld: gestoert,
  alarmeDesKontos: gestoert,
  alleAktivenAlarme: gestoert,
});

test('Preisalarme: ein Lesefehler ist keine leere Liste', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const db = testDaten();
  const name = `pal_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const p = testDienste().finanzen.preisalarm;
  const SN = `92${String(process.pid).slice(-4)}-1`;

  await t.test('alle Alarme', () => assert.rejects(p.alleAlarme(uid), /Tabelle gestört/));
  await t.test('ausgelöste Alarme seit einer Marke', () =>
    assert.rejects(p.ausgeloesteSeit(uid, new Date(0)), /Tabelle gestört/),
  );
  await t.test('setzeAlarm liest nach dem Schreiben', () =>
    assert.rejects(
      p.setzeAlarm(uid, SN, 'EUR', { richtung: 'unter', schwelle: 10, condition: 'N' }),
      /Tabelle gestört/,
    ),
  );
  await t.test('der Preislauf sieht den Fehler', () =>
    assert.rejects(p.pruefeSet(SN, { baueAlarmMail: () => ({}), sendMail: async () => ({}) }), /Tabelle gestört/),
  );
});
