/**
 * A new e-mail address only applies after the link to it (security review
 * round 12, N1). Until then the old one stays, and the new one occupies nothing: its
 * owner can register with it, and forgot-password finds no account via
 * an unconfirmed address. Since round 13 (N1) a … also creates
 *
 * Counter-checks (measured 04.11.2026, each alone):
 *   A  PUT /profile writes the address to users.email immediately again → red:
 *      “a new address only applies after the link”
 *   B  registerAccount() writes the address to users.email again → red:
 *      “the pending address occupies nothing” and “on redeeming …”
 *   C  activeAccountAfterEmail() without `AND email_verified` → red: “forgot
 *      password only for confirmed addresses”
 *   D  assertLoginAllowed() without the condition `registration_pending` → red: “a
 *      foreign registration does not lock the address” (mallory logs in)
 *   E  adoptEmailNew() without OHNE_RUECKSETZLINK → red: “once redeemed the
 *      new address applies” (the reset link to the old address still applies)
 *   F  in 0096 the condition `NOT registration_pending` deleted → red:
 *      “migration 0096 …”; in 0097 `email = NULL` deleted → red: “migrations
 *      0096 and 0097 …” (measured on a fresh DB, otherwise the checksum applies)
 *   G  reportPendingAddresses() without a query (empty list) → red: the same check
 *   H  renewEmailTokenIfFree() without `HAVING COUNT(*) = 1` → red: “a new
 *      link only for the only open registration”
 *   I  the preview also names new_email (name and address) → red: “the
 *      preview only names the username”
 *   K  the preview calls verifyEmailToken() → red: “… does not redeem”
 *   L  POST /register does not pass `mehrere` → red: “with several open
 *      registrations the mail carries the hint”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.APP_BASE_URL = 'http://localhost';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { noDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { enterMailServer } = require('./helpers/mail-fake');

const post = [];
require('./helpers/sources').replaceServices('mail', {
  mailVerification: async (an, token, _b, _l, kind, multiple) => {
    post.push({ an, kind: kind ?? 'registrierung', token, multiple: !!multiple });
    return { success: true, mode: 'smtp' };
  },
  mailEmailChanged: async (an, _n, fresh) => {
    post.push({ an, kind: 'hinweis', fresh });
    return { success: true };
  },
  mailRegistrationAttempt: async an => {
    post.push({ an, kind: 'versuch' });
    return { success: true, mode: 'smtp' };
  },
  mailPasswordReset: async an => {
    post.push({ an, kind: 'reset' });
    return { success: true };
  },
});

const db = S.testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const P = `en${process.pid}`,
  PASS = 'Passwort-Carol-2026';
const addr = n => `${n}_${P}@example.org`;
const COUNTER = [
  'register|%',
  'register-ziel|%',
  'forgot%',
  'profil-vergabe%',
  'email-bestaetigen|%',
  '%-bestaetigen|%',
  'login%',
  'bestaetigung%',
  'email-vorschau|%',
];

test('new email address only after confirmation', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    noDb(t, e);
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
  const clean = async () => {
    await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
    for (const k of COUNTER) await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [k]);
  };
  await clean();
  const regBefore = (await db.get("SELECT value FROM global_settings WHERE key = 'registration_enabled'"))?.value;
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '1')
                ON CONFLICT (key) DO UPDATE SET value = '1'`);
  const mailBack = await enterMailServer(db);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [`carol_${P}`, addr('alt'), bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await clean();
    if (regBefore === undefined) await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    else await db.run("UPDATE global_settings SET value = $1 WHERE key = 'registration_enabled'", [regBefore]);
    await mailBack();
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { session: { userId: uid, username: `carol_${P}` }, t });
  const callFn = async (method, route, body) => {
    const r = await fetch(`${base}/api/v2/auth${route}`, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const carol = () => db.get('SELECT email, email_verified, new_email, reset_token FROM users WHERE id = $1', [uid]);
  const account = name => db.get('SELECT id, email, new_email FROM users WHERE username = $1', [`${name}_${P}`]);
  const register = (name, email) =>
    callFn('POST', '/register', { username: `${name}_${P}`, email, password: 'Opfer-Passwort-2026!' });
  const linkTo = (an, kind = 'adresse') => post.filter(m => m.an === an && m.kind === kind).at(-1)?.token;
  const signIn = name =>
    callFn('POST', '/login', { username: `${name}_${P}`, password: 'Opfer-Passwort-2026!', without_token: true });

  await t.test('a new address only applies after the link', async () => {
    const r = await callFn('PUT', '/profile', { username: `carol_${P}`, email: addr('opfer'), password_current: PASS });
    assert.deepEqual([r.status, r.body.emailChanged, r.body.emailSent], [200, true, true], JSON.stringify(r.body));
    assert.deepEqual(await carol(), {
      email: addr('alt'),
      email_verified: true,
      new_email: addr('opfer'),
      reset_token: null,
    });
    assert.ok(linkTo(addr('opfer')), 'the link goes to the new address');
    assert.deepEqual(
      post.filter(m => m.kind === 'hinweis'),
      [{ an: addr('alt'), kind: 'hinweis', fresh: addr('opfer') }],
    );
    const profileData = await callFn('GET', '/profile');
    assert.deepEqual([profileData.body.user.email, profileData.body.user.new_email], [addr('alt'), addr('opfer')]);
  });

  await t.test('the pending address occupies nothing', async () => {
    const r = await register('opfer', addr('opfer'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(
      await account('opfer'),
      { id: (await account('opfer')).id, email: null, new_email: addr('opfer') },
      'the owner gets an account, the address only pending until the link',
    );
    assert.equal((await carol()).email, addr('alt'));
  });

  await t.test('forgot password only for confirmed addresses', async () => {
    for (const email of [addr('opfer'), addr('alt')])
      assert.equal((await callFn('POST', '/forgot-password', { email })).status, 200);
    const victim = await db.get('SELECT reset_token FROM users WHERE username = $1', [`opfer_${P}`]);
    assert.equal(victim.reset_token, null, 'Reset link via an unconfirmed address');
    // Counterpart: via the confirmed address one is created, otherwise the case checks nothing.
    assert.notEqual((await carol()).reset_token, null);
  });

  await t.test('it is checked again when redeeming', async () => {
    const victim = await callFn('POST', '/confirm-email', { token: linkTo(addr('opfer'), 'registrierung') });
    assert.equal(victim.status, 200, 'the first confirmation wins');
    assert.equal((await account('opfer')).email, addr('opfer'));
    const r = await callFn('POST', '/confirm-email', { token: linkTo(addr('opfer')) });
    assert.deepEqual([r.status, r.body.code], [400, 'email_taken'], JSON.stringify(r.body));
    const c = await carol();
    assert.deepEqual([c.email, c.new_email], [addr('alt'), null]);
  });

  await t.test('once redeemed the new address applies', async () => {
    assert.equal((await callFn('PUT', '/profile', { email: addr('neu'), password_current: PASS })).status, 200);
    const token = linkTo(addr('neu'));
    assert.equal((await callFn('POST', '/confirm-email', { token })).status, 200);
    assert.deepEqual(await carol(), { email: addr('neu'), email_verified: true, new_email: null, reset_token: null });
    const again = await callFn('POST', '/confirm-email', { token });
    assert.deepEqual([again.status, again.body.code], [400, 'confirmation_link_invalid']);
  });

  const unlinkBrakes = () => db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register%' OR key LIKE 'login%'");
  await t.test('a foreign registration does not block the address', async () => {
    await unlinkBrakes();
    assert.equal((await register('mallory1', addr('ziel'))).status, 200);
    await db.run("UPDATE users SET created_at = NOW() - INTERVAL '25 hours' WHERE username = $1", [`mallory1_${P}`]);
    assert.equal((await register('mallory2', addr('ziel'))).status, 200);
    assert.equal((await register('ziel', addr('ziel'))).status, 200);
    assert.deepEqual(await account('ziel'), { id: (await account('ziel')).id, email: null, new_email: addr('ziel') });
    assert.ok(
      !post.some(m => m.an === addr('ziel') && m.kind === 'versuch'),
      'an unconfirmed registration counts as owner',
    );
    const login = await signIn('mallory2');
    assert.deepEqual([login.status, login.body.code], [401, 'credentials_invalid'], 'an open registration signs in');
    assert.equal(
      (await callFn('POST', '/confirm-email', { token: linkTo(addr('ziel'), 'registrierung') })).status,
      200,
    );
    assert.equal((await account('ziel')).email, addr('ziel'));
    assert.equal((await signIn('ziel')).status, 200);
    await unlinkBrakes();
    const subsequent = await register('mallory3', addr('ziel'));
    assert.equal(subsequent.status, 200);
    assert.equal(await account('mallory3'), undefined, 'after the confirmation the address is taken');
    assert.equal(post.filter(m => m.an === addr('ziel') && m.kind === 'versuch').length, 1);
  });

  await t.test('a new link only for the only open registration', async () => {
    await unlinkBrakes();
    const retry = async email => {
      const prior = post.length;
      await callFn('POST', '/resend-confirmation', { email });
      return post.slice(prior);
    };
    assert.equal((await register('allein', addr('allein'))).status, 200);
    await db.run("UPDATE users SET new_email_until = NOW() + INTERVAL '1 hour' WHERE username = $1", [`allein_${P}`]);
    assert.deepEqual(
      (await retry(addr('allein'))).map(m => [m.an, m.kind]),
      [[addr('allein'), 'registrierung']],
    );
    assert.equal((await register('doppel', addr('allein'))).status, 200);
    await db.run("UPDATE users SET new_email_until = NOW() + INTERVAL '1 hour' WHERE username LIKE $1", [`%_${P}`]);
    assert.deepEqual(await retry(addr('allein')), [], 'with two open registrations a foreign link would go along');
  });

  await t.test('before redeeming the link only names its account', async () => {
    await unlinkBrakes();
    assert.equal((await register('mallory4', addr('zwei'))).status, 200);
    assert.equal((await register('zwei', addr('zwei'))).status, 200);
    const [fremd, own] = post.filter(m => m.an === addr('zwei'));
    assert.deepEqual(
      [fremd.multiple, own.multiple],
      [false, true],
      'with several open registrations the mail carries the hint',
    );
    const preview = token => callFn('POST', '/confirm-email/preview', { token });
    const v = await preview(fremd.token);
    assert.deepEqual(
      [v.status, v.body],
      [200, { success: true, username: `mallory4_${P}` }],
      'the preview names only the user name',
    );
    assert.deepEqual(
      await account('mallory4'),
      { id: (await account('mallory4')).id, email: null, new_email: addr('zwei') },
      'the preview does not redeem',
    );
    for (const wrong of ['falsch', '', undefined]) {
      const r = await preview(wrong);
      assert.deepEqual([r.status, r.body.code, r.body.username], [400, 'confirmation_link_invalid', undefined]);
    }
    const login = await callFn('POST', '/login', { username: `mallory4_${P}`, password: 'Opfer-Passwort-2026!' });
    assert.deepEqual(
      [login.status, login.body.token],
      [401, undefined],
      'no sign-in before the confirmation, so no second factor either',
    );
    assert.equal((await callFn('POST', '/confirm-email', { token: own.token })).status, 200);
    assert.equal((await preview(own.token)).status, 400, 'a redeemed link names nothing anymore');
  });

  await t.test('migrations 0096 and 0097 make the legacy data pending, startup reports it', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0096-email-neu.sql'), 'utf8');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      const fresh = async (name, columns) =>
        (
          await c.query(
            `INSERT INTO users (username, password_hash, email, email_verified,
        registration_pending, verification_token, token_expires) VALUES ($1, 'x', $2, $3, $4, $5, NOW() + $6::interval) RETURNING id`,
            [`${name}_${P}`, addr(name), ...columns],
          )
        ).rows[0].id;
      const ids = {
        valid: await fresh('gueltig', [false, false, 'h1', '2 hours']),
        alt: await fresh('altlink', [false, false, 'h2', '-2 hours']),
        open: await fresh('offen', [false, true, 'h3', '2 hours']),
        fest: await fresh('fest', [true, false, null, '0 hours']),
      };
      // Migration 0096 is history and still names the columns by their
      // old name; 0124 (applied long ago) would otherwise have renamed them
      // right afterwards, as in a real order of migrations.
      await c.query(`ALTER TABLE users RENAME COLUMN new_email TO email_neu`);
      await c.query(`ALTER TABLE users RENAME COLUMN new_email_token TO email_neu_token`);
      await c.query(`ALTER TABLE users RENAME COLUMN new_email_until TO email_neu_bis`);
      await c.query(`ALTER TABLE users RENAME COLUMN registration_pending TO registrierung_offen`);
      await c.query(sql.slice(sql.indexOf('UPDATE users')));
      await c.query(`ALTER TABLE users RENAME COLUMN email_neu TO new_email`);
      await c.query(`ALTER TABLE users RENAME COLUMN email_neu_token TO new_email_token`);
      await c.query(`ALTER TABLE users RENAME COLUMN email_neu_bis TO new_email_until`);
      await c.query(`ALTER TABLE users RENAME COLUMN registrierung_offen TO registration_pending`);
      const z = Object.fromEntries(
        (
          await c.query(
            `SELECT id, email, new_email, new_email_token, new_email_until IS NOT NULL AS until,
        verification_token FROM users WHERE id = ANY($1)`,
            [Object.values(ids)],
          )
        ).rows.map(r => [r.id, r]),
      );
      assert.deepEqual(z[ids.valid], {
        id: ids.valid,
        email: null,
        new_email: addr('gueltig'),
        new_email_token: 'h1',
        until: true,
        verification_token: null,
      });
      assert.deepEqual(z[ids.alt], {
        id: ids.alt,
        email: null,
        new_email: addr('altlink'),
        new_email_token: null,
        until: false,
        verification_token: null,
      });
      assert.equal(z[ids.open].email, addr('offen'), 'an open registration keeps its address');
      assert.equal(z[ids.fest].email, addr('fest'));
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    const c2 = await db.pool.connect();
    try {
      await c2.query('BEGIN');
      const m97 = fs.readFileSync(path.join(ROOT, 'db/migrations/0097-registrierung-ausstehend.sql'), 'utf8');
      const ids = (
        await c2.query(
          `INSERT INTO users (username, password_hash, email, email_verified, registration_pending,
        verification_token, token_expires) VALUES ($1, 'x', $2, false, true, 'h4', NOW() + INTERVAL '2 hours'),
        ($3, 'x', $4, true, false, NULL, NULL) RETURNING id`,
          [`reg_${P}`, addr('reg'), `best_${P}`, addr('best')],
        )
      ).rows.map(r => r.id);
      // Migration 0097 is history and still names the columns by their
      // old name; see the rationale at migration 0096 further up.
      await c2.query(`ALTER TABLE users RENAME COLUMN new_email TO email_neu`);
      await c2.query(`ALTER TABLE users RENAME COLUMN new_email_token TO email_neu_token`);
      await c2.query(`ALTER TABLE users RENAME COLUMN new_email_until TO email_neu_bis`);
      await c2.query(`ALTER TABLE users RENAME COLUMN registration_pending TO registrierung_offen`);
      await c2.query(m97);
      await c2.query(`ALTER TABLE users RENAME COLUMN email_neu TO new_email`);
      await c2.query(`ALTER TABLE users RENAME COLUMN email_neu_token TO new_email_token`);
      await c2.query(`ALTER TABLE users RENAME COLUMN email_neu_bis TO new_email_until`);
      await c2.query(`ALTER TABLE users RENAME COLUMN registrierung_offen TO registration_pending`);
      const z = (
        await c2.query(
          `SELECT email, new_email, new_email_token, new_email_until IS NOT NULL AS until, verification_token
        FROM users WHERE id = ANY($1) ORDER BY id`,
          [ids],
        )
      ).rows;
      assert.deepEqual(
        z,
        [
          { email: null, new_email: addr('reg'), new_email_token: 'h4', until: true, verification_token: null },
          { email: addr('best'), new_email: null, new_email_token: null, until: false, verification_token: null },
        ],
        'Migration 0097 …',
      );
    } finally {
      await c2.query('ROLLBACK');
      c2.release();
    }
    const h5 = (
      await db.get(`INSERT INTO users (username, password_hash, new_email) VALUES ($1, 'x', $2) RETURNING id`, [
        `h5_${P}`,
        addr('h5'),
      ])
    ).id;
    const { reportPendingAddresses } = _req('src/account/accounts.js');
    assert.ok((await reportPendingAddresses()).includes(h5));
    assert.ok(!(await reportPendingAddresses()).includes(uid));
  });
});
