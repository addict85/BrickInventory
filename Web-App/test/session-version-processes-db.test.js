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

const { until } = require('./helpers/time');

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
  const otherOne = new Client({ connectionString: process.env.DATABASE_URL });
  await otherOne.connect();
  t.after(async () => {
    await signals.close();
    await otherOne.end().catch(() => {});
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
  let ready = false;
  const done = () => {
    ready = true;
  };
  signals.listen('sitzung_version', done);
  await until(() => ready, 5000);
  signals.unlisten('sitzung_version', done);
  assert.ok(ready, 'the listen connection did not come about');

  await t.test('an increment from another process applies immediately', async () => {
    const prior = await sv.currentSessionVersion(uid);
    await higher();
    assert.equal(await sv.currentSessionVersion(uid), prior, 'precondition: the cache still holds it');
    await otherOne.query("SELECT pg_notify('sitzung_version', 'anderer')");
    const fresh = await inDb();
    assert.ok(
      await until(async () => (await sv.currentSessionVersion(uid)) === fresh, 1000),
      'the old version stays valid in the cache',
    );
  });

  await t.test('an increment here notifies the others', async () => {
    const belongsTo = [];
    otherOne.on('notification', m => belongsTo.push(m.channel));
    await otherOne.query('LISTEN sitzung_version');
    await _req('src/account/accessEnd.js').endAllSessions(uid);
    await until(() => belongsTo.length > 0, 1000);
    assert.deepEqual(belongsTo.slice(0, 1), ['sitzung_version']);
  });
});
