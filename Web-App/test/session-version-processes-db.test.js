/**
 * The session version is cached per web process for five seconds
 * (src/account/sessionVersion.ts). An increment in one process announces itself via
 * NOTIFY, the others discard their state immediately; without a listening connection only
 * the database applies.
 *
 * Counter-checks (measured 16.11.2026, each on its own):
 *   A  verbinde() deleted in listenOnSessionVersion() → red: “an increment
 *      from another process applies immediately” (the old version stayed)
 *   B  melde() deleted in increaseSessionVersion() → red: “an increment here notifies
 *      the others”
 *   C  nutzbar() always delivers true → red: “without a listen connection …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
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

test('session version across all processes', { concurrency: 1 }, async t => {
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
  const higher = () => db.run('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [uid]);
  const inDb = async () => (await db.get('SELECT session_version AS v FROM users WHERE id = $1', [uid])).v;

  await t.test('without a listen connection only the database applies', async () => {
    await sv.currentSessionVersion(uid);
    await higher();
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
  assert.ok(bereit, 'the listen connection did not come about');

  await t.test('an increment from another process applies immediately', async () => {
    const vorher = await sv.currentSessionVersion(uid);
    await higher();
    assert.equal(await sv.currentSessionVersion(uid), vorher, 'precondition: the cache still holds it');
    await anderer.query("SELECT pg_notify('sitzung_version', 'anderer')");
    const neu = await inDb();
    assert.ok(
      await bis(async () => (await sv.currentSessionVersion(uid)) === neu, 1000),
      'the old version stays valid in the cache',
    );
  });

  await t.test('an increment here notifies the others', async () => {
    const belongsTo = [];
    anderer.on('notification', m => belongsTo.push(m.channel));
    await anderer.query('LISTEN sitzung_version');
    await _req('src/account/accessEnd.js').endAllSessions(uid);
    await bis(() => belongsTo.length > 0, 1000);
    assert.deepEqual(belongsTo.slice(0, 1), ['sitzung_version']);
  });
});
