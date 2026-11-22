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
  mailEmailChanged: async (an, _n, neu) => {
    post.push({ an, kind: 'hinweis', neu });
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

  const { base } = testServer(_req, { sitzung: { userId: uid, username: `carol_${P}` }, t });
  const callFn = async (methode, weg, body) => {
    const r = await fetch(`${base}/api/v2/auth${weg}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const carol = () => db.get('SELECT email, email_verified, new_email, reset_token FROM users WHERE id = $1', [uid]);
  const konto = name => db.get('SELECT id, email, new_email FROM users WHERE username = $1', [`${name}_${P}`]);
  const register = (name, email) =>
    callFn('POST', '/register', { username: `${name}_${P}`, email, password: 'Opfer-Passwort-2026!' });
  const linkTo = (an, kind = 'adresse') => post.filter(m => m.an === an && m.kind === kind).at(-1)?.token;
  const anmelden = name =>
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
    assert.ok(linkTo(addr('opfer')), 'der Link geht an die neue Adresse');
    assert.deepEqual(
      post.filter(m => m.kind === 'hinweis'),
      [{ an: addr('alt'), kind: 'hinweis', neu: addr('opfer') }],
    );
    const profileData = await callFn('GET', '/profile');
    assert.deepEqual([profileData.body.user.email, profileData.body.user.new_email], [addr('alt'), addr('opfer')]);
  });

  await t.test('the pending address occupies nothing', async () => {
    const r = await register('opfer', addr('opfer'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(
      await konto('opfer'),
      { id: (await konto('opfer')).id, email: null, new_email: addr('opfer') },
      'der Inhaber bekommt ein Konto, die Adresse bis zum Link nur ausstehend',
    );
    assert.equal((await carol()).email, addr('alt'));
  });

  await t.test('forgot password only for confirmed addresses', async () => {
    for (const email of [addr('opfer'), addr('alt')])
      assert.equal((await callFn('POST', '/forgot-password', { email })).status, 200);
    const opfer = await db.get('SELECT reset_token FROM users WHERE username = $1', [`opfer_${P}`]);
    assert.equal(opfer.reset_token, null, 'Rücksetzlink über eine unbestätigte Adresse');
    // Counterpart: via the confirmed address one is created, otherwise the case checks nothing.
    assert.notEqual((await carol()).reset_token, null);
  });

  await t.test('it is checked again when redeeming', async () => {
    const opfer = await callFn('POST', '/confirm-email', { token: linkTo(addr('opfer'), 'registrierung') });
    assert.equal(opfer.status, 200, 'die erste Bestätigung gewinnt');
    assert.equal((await konto('opfer')).email, addr('opfer'));
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
    const nochmal = await callFn('POST', '/confirm-email', { token });
    assert.deepEqual([nochmal.status, nochmal.body.code], [400, 'confirmation_link_invalid']);
  });

  const unlinkBrakes = () => db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register%' OR key LIKE 'login%'");
  await t.test('a foreign registration does not block the address', async () => {
    await unlinkBrakes();
    assert.equal((await register('mallory1', addr('ziel'))).status, 200);
    await db.run("UPDATE users SET created_at = NOW() - INTERVAL '25 hours' WHERE username = $1", [`mallory1_${P}`]);
    assert.equal((await register('mallory2', addr('ziel'))).status, 200);
    assert.equal((await register('ziel', addr('ziel'))).status, 200);
    assert.deepEqual(await konto('ziel'), { id: (await konto('ziel')).id, email: null, new_email: addr('ziel') });
    assert.ok(
      !post.some(m => m.an === addr('ziel') && m.kind === 'versuch'),
      'eine unbestätigte Registrierung gilt als Inhaber',
    );
    const login = await anmelden('mallory2');
    assert.deepEqual(
      [login.status, login.body.code],
      [401, 'credentials_invalid'],
      'eine offene Registrierung meldet sich an',
    );
    assert.equal(
      (await callFn('POST', '/confirm-email', { token: linkTo(addr('ziel'), 'registrierung') })).status,
      200,
    );
    assert.equal((await konto('ziel')).email, addr('ziel'));
    assert.equal((await anmelden('ziel')).status, 200);
    await unlinkBrakes();
    const spaeter = await register('mallory3', addr('ziel'));
    assert.equal(spaeter.status, 200);
    assert.equal(await konto('mallory3'), undefined, 'nach der Bestätigung ist die Adresse vergeben');
    assert.equal(post.filter(m => m.an === addr('ziel') && m.kind === 'versuch').length, 1);
  });

  await t.test('a new link only for the only open registration', async () => {
    await unlinkBrakes();
    const erneut = async email => {
      const vorher = post.length;
      await callFn('POST', '/resend-confirmation', { email });
      return post.slice(vorher);
    };
    assert.equal((await register('allein', addr('allein'))).status, 200);
    await db.run("UPDATE users SET new_email_until = NOW() + INTERVAL '1 hour' WHERE username = $1", [`allein_${P}`]);
    assert.deepEqual(
      (await erneut(addr('allein'))).map(m => [m.an, m.kind]),
      [[addr('allein'), 'registrierung']],
    );
    assert.equal((await register('doppel', addr('allein'))).status, 200);
    await db.run("UPDATE users SET new_email_until = NOW() + INTERVAL '1 hour' WHERE username LIKE $1", [`%_${P}`]);
    assert.deepEqual(await erneut(addr('allein')), [], 'bei zwei offenen Registrierungen ginge ein fremder Link mit');
  });

  await t.test('before redeeming the link only names its account', async () => {
    await unlinkBrakes();
    assert.equal((await register('mallory4', addr('zwei'))).status, 200);
    assert.equal((await register('zwei', addr('zwei'))).status, 200);
    const [fremd, eigen] = post.filter(m => m.an === addr('zwei'));
    assert.deepEqual(
      [fremd.multiple, eigen.multiple],
      [false, true],
      'bei mehreren offenen Registrierungen trägt die Mail den Hinweis',
    );
    const preview = token => callFn('POST', '/confirm-email/preview', { token });
    const v = await preview(fremd.token);
    assert.deepEqual(
      [v.status, v.body],
      [200, { success: true, username: `mallory4_${P}` }],
      'die Vorschau nennt nur den Benutzernamen',
    );
    assert.deepEqual(
      await konto('mallory4'),
      { id: (await konto('mallory4')).id, email: null, new_email: addr('zwei') },
      'die Vorschau löst nicht ein',
    );
    for (const falsch of ['falsch', '', undefined]) {
      const r = await preview(falsch);
      assert.deepEqual([r.status, r.body.code, r.body.username], [400, 'confirmation_link_invalid', undefined]);
    }
    const login = await callFn('POST', '/login', { username: `mallory4_${P}`, password: 'Opfer-Passwort-2026!' });
    assert.deepEqual(
      [login.status, login.body.token],
      [401, undefined],
      'vor der Bestätigung keine Anmeldung, also auch kein zweiter Faktor',
    );
    assert.equal((await callFn('POST', '/confirm-email', { token: eigen.token })).status, 200);
    assert.equal((await preview(eigen.token)).status, 400, 'ein eingelöster Link nennt nichts mehr');
  });

  await t.test('migrations 0096 and 0097 make the legacy data pending, startup reports it', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0096-email-neu.sql'), 'utf8');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      const neu = async (name, spalten) =>
        (
          await c.query(
            `INSERT INTO users (username, password_hash, email, email_verified,
        registration_pending, verification_token, token_expires) VALUES ($1, 'x', $2, $3, $4, $5, NOW() + $6::interval) RETURNING id`,
            [`${name}_${P}`, addr(name), ...spalten],
          )
        ).rows[0].id;
      const ids = {
        gueltig: await neu('gueltig', [false, false, 'h1', '2 hours']),
        alt: await neu('altlink', [false, false, 'h2', '-2 hours']),
        open: await neu('offen', [false, true, 'h3', '2 hours']),
        fest: await neu('fest', [true, false, null, '0 hours']),
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
            `SELECT id, email, new_email, new_email_token, new_email_until IS NOT NULL AS bis,
        verification_token FROM users WHERE id = ANY($1)`,
            [Object.values(ids)],
          )
        ).rows.map(r => [r.id, r]),
      );
      assert.deepEqual(z[ids.gueltig], {
        id: ids.gueltig,
        email: null,
        new_email: addr('gueltig'),
        new_email_token: 'h1',
        bis: true,
        verification_token: null,
      });
      assert.deepEqual(z[ids.alt], {
        id: ids.alt,
        email: null,
        new_email: addr('altlink'),
        new_email_token: null,
        bis: false,
        verification_token: null,
      });
      assert.equal(z[ids.open].email, addr('offen'), 'eine offene Registrierung behält ihre Adresse');
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
          `SELECT email, new_email, new_email_token, new_email_until IS NOT NULL AS bis, verification_token
        FROM users WHERE id = ANY($1) ORDER BY id`,
          [ids],
        )
      ).rows;
      assert.deepEqual(
        z,
        [
          { email: null, new_email: addr('reg'), new_email_token: 'h4', bis: true, verification_token: null },
          { email: addr('best'), new_email: null, new_email_token: null, bis: false, verification_token: null },
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
