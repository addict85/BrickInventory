/**
 * An account deletes itself (DELETE /api/v1/auth/konto) with password and,
 * if set up, second factor; the last administrator cannot.
 * Unconfirmed registrations are cleared by the daily run after seven days,
 * accounts with only a not yet confirmed new address are not.
 *
 * Counter-checks (measured on 04.11.2026, one change each, reverted afterwards):
 *   A  confirmWithFactor() deleted in the route → red: “without a password
 *      the account stays …” and “with second factor …”
 *   B  deleteOwnAccount() without the administrator condition → red: “the last
 *      administrator stays”
 *   C  deleteOpenRegistrations() without `registration_pending` → red:
 *      “unconfirmed registrations …” (the account with a new address is gone)
 *   D  the step missing in cleanupDaily() → red: the same check
 *      (the old registration stays)
 * Measured, stayed green (04.11.2026): adoptEmailNew() without `registration_pending = false` —
 * deletion additionally requires NOT email_verified.
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Loeschen-Passwort-1';

test('delete own account and open registrations', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const P = process.pid,
    NAMEN = ['weg', 'zf', 'chef', 'offen_alt', 'offen_neu', 'adresse', 'bestaetigt'].map(n => `ksl_${n}_${P}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  // Only this administrator: the other accounts of the test DB must not fulfill the condition.
  await db.run('UPDATE users SET is_active = false WHERE is_admin AND NOT (username = ANY($1))', [NAMEN]);
  const konto = async (name, admin = false) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [name, `${name}@example.org`, await bcrypt.hash(PASS, 4), admin],
      )
    ).id;
  const da = async id => !!(await db.get('SELECT 1 FROM users WHERE id = $1', [id]));
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const als = uid => {
    const { base } = testServer(_req, { sitzung: { userId: uid, destroy: cb => cb() }, t });
    return async body => {
      const r = await fetch(`${base}/api/v1/auth/konto`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
  };

  await t.test('without password the account stays, with password it is gone', async () => {
    const id = await konto(NAMEN[0]);
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10294-1')`, [id]);
    const loesche = als(id);
    assert.ok((await loesche({})).status >= 400);
    assert.ok((await loesche({ password: 'falsch-falsch-1' })).status >= 400);
    assert.ok(await da(id));
    const r = await loesche({ password: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await da(id), false);
    assert.equal((await db.get('SELECT count(*)::int AS n FROM sets WHERE user_id = $1', [id])).n, 0);
  });

  await t.test('with a second factor the password is not enough', async () => {
    const id = await konto(NAMEN[1]);
    await db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', true)`, [id]);
    const r = await als(id)({ password: PASS });
    assert.equal(r.body.code, 'zweiter_faktor_noetig', JSON.stringify(r.body));
    assert.ok(await da(id));
  });

  await t.test('the last admin stays', async () => {
    const id = await konto(NAMEN[2], true);
    const r = await als(id)({ password: PASS });
    assert.deepEqual([r.status, r.body.code], [409, 'letzter_verwalter']);
    assert.ok(await da(id));
  });

  const K = { ..._req('src/account/accounts.js'), ...require('./helpers/sources').testArea('account').konten };
  const { verifyEmailToken } = _req('src/account/loginCheck.js');
  const { tokenDigest } = _req('src/account/deviceToken.js');
  const registered = async (name, daysAlt) => {
    const roh = crypto.randomBytes(16).toString('hex');
    const id = await K.register({
      username: name,
      email: `${name}@example.org`,
      passwort: PASS,
      tokenHash: tokenDigest(roh),
      bis: new Date(Date.now() + 86_400_000),
    });
    await db.run(`UPDATE users SET created_at = NOW() - make_interval(days => $2) WHERE id = $1`, [id, daysAlt]);
    return { id, roh };
  };

  await t.test('unconfirmed registrations after seven days', async () => {
    const alt = await registered(NAMEN[3], 8),
      neu = await registered(NAMEN[4], 6);
    const bestaetigt = await registered(NAMEN[6], 8);
    assert.ok((await verifyEmailToken(bestaetigt.roh)).userId);
    // An old account whose new address is not yet confirmed.
    const adresse = await konto(NAMEN[5]);
    await db.run(
      `UPDATE users SET email_verified = false, verification_token = 'x', created_at = NOW() - INTERVAL '30 days' WHERE id = $1`,
      [adresse],
    );

    await _req('src/management/cleanup.js').cleanupDaily();
    const stand = {
      alt: await da(alt.id),
      neu: await da(neu.id),
      bestaetigt: await da(bestaetigt.id),
      adresse: await da(adresse),
    };
    assert.deepEqual(stand, { alt: false, neu: true, bestaetigt: true, adresse: true });
  });
});
