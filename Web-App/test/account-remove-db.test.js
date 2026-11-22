/**
 * Removing an account: log, row and sessions in one transaction,
 * files afterwards with compensation (job “konto_dateien”) if they cannot
 * be deleted. One flow for administrators and the own account (src/account/removeAccount.ts).
 *
 * Counter-checks (measured 09.11.2026, each alone):
 *   A  in removeAccount() session version and sessions deleted only after the transaction
 *      → red: “if a step fails, everything stays as it was” (account gone)
 *   B  protokolliere() after the transaction → red: the same check (entry without deletion)
 *   C  in removeAccountFiles() the catch removed → red: “if the files are
 *      stuck, a job takes over” (the deletion reports an error)
 *
 * The session deletion fails on a trigger in the database (like a real
 * error there), not on a bent module. A repeated like this on 13.11.2026: red.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('remove account', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const { removeAccount, removeAccountFiles } = _req('src/account/removeAccount.js');
  const P = process.pid;
  const ADMIN_NAME = `entf-verw-${P}`,
    ZIEL = `entf-ziel-${P}`;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[ADMIN_NAME, ZIEL]]);
    await db.run("DELETE FROM jobs WHERE type = 'account_files'");
  };
  await weg();
  const verw = (
    await db.get(
      "INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1, 'x', true, true) RETURNING id",
      [ADMIN_NAME],
    )
  ).id;
  const neu = async () =>
    (await db.get("INSERT INTO users (username, password_hash, is_active) VALUES ($1, 'x', true) RETURNING id", [ZIEL]))
      .id;
  const sitzung = uid =>
    db.run(`INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, NOW() + interval '1 hour')`, [
      `entf-${uid}`,
      JSON.stringify({ userId: uid, cookie: {} }),
    ]);
  const state = async uid => ({
    konto: !!(await db.get('SELECT 1 FROM users WHERE id = $1', [uid])),
    sitzungen: (
      await db.get("SELECT COUNT(*)::int AS n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])
    ).n,
    protokoll: (
      await db.get("SELECT COUNT(*)::int AS n FROM admin_log WHERE target_id = $1 AND action = 'account_deleted'", [
        uid,
      ])
    ).n,
  });
  t.after(async () => {
    await weg().catch(() => {});
    await db.run("DELETE FROM user_sessions WHERE sid LIKE 'entf-%'").catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('if a step fails, everything stays as it was', async () => {
    const ziel = await neu();
    await sitzung(ziel);
    await db.exec(`CREATE FUNCTION entf_sperre() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Sitzungen nicht löschbar'; END $$;
      CREATE TRIGGER entf_sperre BEFORE DELETE ON user_sessions
        FOR EACH ROW WHEN (OLD.sid = 'entf-${ziel}') EXECUTE FUNCTION entf_sperre()`);
    try {
      await assert.rejects(removeAccount(ziel, verw), /Sitzungen nicht löschbar/);
    } finally {
      await db.exec('DROP TRIGGER entf_sperre ON user_sessions; DROP FUNCTION entf_sperre()');
    }
    assert.deepEqual(await state(ziel), { konto: true, sitzungen: 1, protokoll: 0 });
    await db.run('DELETE FROM users WHERE id = $1', [ziel]);
    await db.run('DELETE FROM user_sessions WHERE sid = $1', [`entf-${ziel}`]);
  });

  await t.test('if it succeeds, account and sessions are gone and logged', async () => {
    const ziel = await neu();
    await sitzung(ziel);
    await removeAccount(ziel, verw);
    assert.deepEqual(await state(ziel), { konto: false, sitzungen: 0, protokoll: 1 });
    const NICHT = { code: 'user_not_found_or_own' };
    await assert.rejects(removeAccount(ziel, verw), NICHT);
    await assert.rejects(removeAccount(verw, verw), NICHT, 'not the own account via the admin path');
  });

  await t.test('if the files are locked, a job takes over', async () => {
    const echt = fs.promises.rm;
    fs.promises.rm = async () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    };
    let r;
    try {
      r = await removeAccountFiles(987654);
    } finally {
      fs.promises.rm = echt;
    }
    assert.equal(r, 'eingereiht');
    const a = await db.get("SELECT payload, dedupe_key FROM jobs WHERE type = 'account_files' AND dedupe_key = $1", [
      'account_files:987654',
    ]);
    assert.ok(a, 'no job to retry');
    assert.equal(a.payload.user_id, 987654);
    assert.equal(await removeAccountFiles(987654), 'entfernt', 'without a failure it works right away');
  });
});
