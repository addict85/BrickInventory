/**
 * An active administrator always remains, even if two administrators
 * revoke, deactivate or delete each other at the same time. Previously only the
 * own account was protected: both still saw the other as administrator.
 *
 * Counter-checks (measured on 07.11.2026, each alone):
 *   A  the lock (pg_advisory_xact_lock) removed in belowAdminLock() →
 *      red: “concurrent revocation of the role”, “concurrent deactivation”,
 *      “concurrent deletion”, “revocation against deactivation” (both calls get through)
 *   B  the condition ANDERER_VERWALTER removed from the UPDATE in setAdmin()
 *      → red: “the last administrator keeps the role” and the
 *      concurrent revocation
 *   C  (13.11.2026) in belowAdminLock() the check inTransaction() deleted
 *      → red: “the last administrator keeps …” (deleteAccount without transaction got through)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const K = { ..._req('src/account/accounts.js'), ...require('./helpers/sources').testArea('account').accounts };
/** The service throws the refusal; here it becomes a value so that concurrent calls stay countable. */
const LAST = 'last_admin';
const asValue = p => p.catch(e => (e?.code === LAST ? LAST : Promise.reject(e)));
/** Like removeAccount(), without log: its entry for the concurrently deleted administrator would hit the foreign key. */
/** In the system context as there: only the system role deletes accounts (0117). */
const remove = (target, via) =>
  _req('src/infra/accountContext.js').inSystemContext('test', () =>
    require('./helpers/sources')
      .testContext('account')
      .transact(t => t.accounts.deleteAccount(target, via)),
  );

const ROUNDS = 12;

test('admins: at the same time one always stays active', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    NAMES = ['a', 'b'].map(n => `vb_${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMES]);
  // Only these two administrators count; the other accounts of the test DB are hidden for the duration.
  const foreignOnes = (await db.all('SELECT id FROM users WHERE is_admin AND is_active')).map(z => z.id);
  await db.run('UPDATE users SET is_active = false WHERE id = ANY($1)', [foreignOnes]);
  const fresh = async name =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, 'x', true, true, true) RETURNING id`,
        [name, `${name}@example.org`],
      )
    ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMES]).catch(() => {});
    await db.run('UPDATE users SET is_active = true WHERE id = ANY($1)', [foreignOnes]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const activeAdmin = async () =>
    (await db.get('SELECT count(*)::int AS n FROM users WHERE is_admin AND is_active AND username = ANY($1)', [NAMES]))
      .n;
  const reset = async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMES]);
    return [await fresh(NAMES[0]), await fresh(NAMES[1])];
  };
  /** Fresh accounts in every round; exactly one of the two calls may get through. */
  const simultaneous = async call => {
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y] = await reset();
      const r = await Promise.all([call(x, y), call(y, x)]);
      const rejected = r.filter(e => e === LAST).length;
      assert.equal(rejected, 1, `Round ${i}: ${JSON.stringify(r)}`);
      assert.equal(await activeAdmin(), 1, `Round ${i}: no active admin left`);
    }
  };

  await t.test('the last admin keeps the role and the account active', async () => {
    const [x, y] = await reset();
    assert.deepEqual(await K.setAdminFlag(y, false), { changed: true });
    assert.equal(await asValue(K.setAdminFlag(x, false)), LAST);
    assert.equal(await asValue(K.setActiveFlag(x, false)), LAST);
    assert.equal(await remove(x, y), LAST);
    await assert.rejects(
      K.deleteAccount(x, y),
      /nur in einer Transaktion/,
      'without a transaction the lock protected nothing',
    );
    assert.equal(await activeAdmin(), 1);
    // Another administrator may leave again, the role of non-administrators is free.
    assert.deepEqual(await K.setAdminFlag(y, true), { changed: true });
    assert.deepEqual(await K.setActiveFlag(y, false), { changed: true });
    await assert.rejects(K.setAdminFlag(999999999, false), { code: 'user_not_found' });
  });

  await t.test('concurrent revocation of the role', async () => {
    await simultaneous(target => asValue(K.setAdminFlag(target, false)).then(r => (r?.changed === true ? 'ok' : r)));
  });

  await t.test('concurrent deactivation', async () => {
    await simultaneous(target => asValue(K.setActiveFlag(target, false)).then(r => (r?.changed === true ? 'ok' : r)));
  });

  await t.test('concurrent deletion', async () => {
    await simultaneous((target, ich) => remove(target, ich).then(r => (r === true ? 'ok' : r)));
  });

  await t.test('revocation against deactivation, concurrently', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y] = await reset();
      const r = await Promise.all([asValue(K.setAdminFlag(x, false)), asValue(K.setActiveFlag(y, false))]);
      assert.equal(r.filter(e => e === LAST).length, 1, `Round ${i}: ${JSON.stringify(r)}`);
      assert.equal(await activeAdmin(), 1, `Round ${i}`);
    }
  });
});
