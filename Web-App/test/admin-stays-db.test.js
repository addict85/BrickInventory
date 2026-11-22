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
const K = { ..._req('src/account/accounts.js'), ...require('./helpers/sources').testArea('account').konten };
/** The service throws the refusal; here it becomes a value so that concurrent calls stay countable. */
const LAST = 'last_admin';
const alsWert = p => p.catch(e => (e?.code === LAST ? LAST : Promise.reject(e)));
/** Like removeAccount(), without log: its entry for the concurrently deleted administrator would hit the foreign key. */
/** In the system context as there: only the system role deletes accounts (0117). */
const remove = (ziel, durch) =>
  _req('src/infra/accountContext.js').inSystemContext('test', () =>
    require('./helpers/sources')
      .testContext('account')
      .transact(t => t.konten.deleteAccount(ziel, durch)),
  );

const ROUNDS = 12;

test('admins: at the same time one always stays active', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    NAMEN = ['a', 'b'].map(n => `vb_${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  // Only these two administrators count; the other accounts of the test DB are hidden for the duration.
  const fremde = (await db.all('SELECT id FROM users WHERE is_admin AND is_active')).map(z => z.id);
  await db.run('UPDATE users SET is_active = false WHERE id = ANY($1)', [fremde]);
  const neu = async name =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, 'x', true, true, true) RETURNING id`,
        [name, `${name}@example.org`],
      )
    ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {});
    await db.run('UPDATE users SET is_active = true WHERE id = ANY($1)', [fremde]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const activeAdmin = async () =>
    (await db.get('SELECT count(*)::int AS n FROM users WHERE is_admin AND is_active AND username = ANY($1)', [NAMEN]))
      .n;
  const zuruecksetzen = async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
    return [await neu(NAMEN[0]), await neu(NAMEN[1])];
  };
  /** Fresh accounts in every round; exactly one of the two calls may get through. */
  const gleichzeitig = async call => {
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y] = await zuruecksetzen();
      const r = await Promise.all([call(x, y), call(y, x)]);
      const abgelehnt = r.filter(e => e === LAST).length;
      assert.equal(abgelehnt, 1, `Runde ${i}: ${JSON.stringify(r)}`);
      assert.equal(await activeAdmin(), 1, `Runde ${i}: kein aktiver Verwalter mehr`);
    }
  };

  await t.test('the last admin keeps the role and the account active', async () => {
    const [x, y] = await zuruecksetzen();
    assert.deepEqual(await K.setzeVerwalterRolle(y, false), { changed: true });
    assert.equal(await alsWert(K.setzeVerwalterRolle(x, false)), LAST);
    assert.equal(await alsWert(K.setzeAktiv(x, false)), LAST);
    assert.equal(await remove(x, y), LAST);
    await assert.rejects(
      K.deleteAccount(x, y),
      /nur in einer Transaktion/,
      'ohne Transaktion schützte die Sperre nichts',
    );
    assert.equal(await activeAdmin(), 1);
    // Another administrator may leave again, the role of non-administrators is free.
    assert.deepEqual(await K.setzeVerwalterRolle(y, true), { changed: true });
    assert.deepEqual(await K.setzeAktiv(y, false), { changed: true });
    await assert.rejects(K.setzeVerwalterRolle(999999999, false), { code: 'user_not_found' });
  });

  await t.test('concurrent revocation of the role', async () => {
    await gleichzeitig(ziel => alsWert(K.setzeVerwalterRolle(ziel, false)).then(r => (r?.changed === true ? 'ok' : r)));
  });

  await t.test('concurrent deactivation', async () => {
    await gleichzeitig(ziel => alsWert(K.setzeAktiv(ziel, false)).then(r => (r?.changed === true ? 'ok' : r)));
  });

  await t.test('concurrent deletion', async () => {
    await gleichzeitig((ziel, ich) => remove(ziel, ich).then(r => (r === true ? 'ok' : r)));
  });

  await t.test('revocation against deactivation, concurrently', async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const [x, y] = await zuruecksetzen();
      const r = await Promise.all([alsWert(K.setzeVerwalterRolle(x, false)), alsWert(K.setzeAktiv(y, false))]);
      assert.equal(r.filter(e => e === LAST).length, 1, `Runde ${i}: ${JSON.stringify(r)}`);
      assert.equal(await activeAdmin(), 1, `Runde ${i}`);
    }
  });
});
