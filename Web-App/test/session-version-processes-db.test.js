/**
 * Die Sitzungsversion wird je Web-Prozess fünf Sekunden zwischengespeichert
 * (src/account/sessionVersion.ts). Eine Erhöhung in einem Prozess meldet sich über
 * NOTIFY, die anderen verwerfen ihren Stand sofort; ohne Horch-Verbindung gilt nur
 * die Datenbank.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln):
 *   A  in listenOnSessionVersion() das verbinde() gestrichen → rot: „eine Erhöhung
 *      aus einem anderen Prozess gilt sofort“ (die alte Version blieb)
 *   B  in increaseSessionVersion() melde() gestrichen → rot: „eine Erhöhung hier meldet
 *      sich bei den anderen“
 *   C  nutzbar() liefert immer true → rot: „ohne Horch-Verbindung …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const sv = _req('src/account/sessionVersion.js');
const signals = testAccess().notification;
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const { bis } = require('./helpers/time');

test('Sitzungsversion über alle Prozesse', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `sv_prozesse_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
       VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  const anderer = new Client({ connectionString: process.env.DATABASE_URL });
  await anderer.connect();
  t.after(async () => {
    await signals.close();
    await anderer.end().catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const hoeher = () => db.run('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [uid]);
  const inDb = async () => (await db.get('SELECT session_version AS v FROM users WHERE id = $1', [uid])).v;

  await t.test('ohne Horch-Verbindung gilt nur die Datenbank', async () => {
    await sv.currentSessionVersion(uid);
    await hoeher();
    assert.equal(await sv.currentSessionVersion(uid), await inDb());
  });

  sv.listenOnSessionVersion();
  let bereit = false;
  const fertig = () => {
    bereit = true;
  };
  signals.listen('sitzung_version', fertig);
  await bis(() => bereit, 5000);
  signals.unlisten('sitzung_version', fertig);
  assert.ok(bereit, 'die Horch-Verbindung kam nicht zustande');

  await t.test('eine Erhöhung aus einem anderen Prozess gilt sofort', async () => {
    const vorher = await sv.currentSessionVersion(uid);
    await hoeher();
    assert.equal(await sv.currentSessionVersion(uid), vorher, 'Vorbedingung: der Zwischenspeicher trägt sie noch');
    await anderer.query("SELECT pg_notify('sitzung_version', 'anderer')");
    const neu = await inDb();
    assert.ok(
      await bis(async () => (await sv.currentSessionVersion(uid)) === neu, 1000),
      'die alte Version gilt im Zwischenspeicher weiter',
    );
  });

  await t.test('eine Erhöhung hier meldet sich bei den anderen', async () => {
    const gehoert = [];
    anderer.on('notification', m => gehoert.push(m.channel));
    await anderer.query('LISTEN sitzung_version');
    await _req('src/account/accessEnd.js').endAllSessions(uid);
    await bis(() => gehoert.length > 0, 1000);
    assert.deepEqual(gehoert.slice(0, 1), ['sitzung_version']);
  });
});
