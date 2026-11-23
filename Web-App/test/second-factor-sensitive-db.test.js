/**
 * With an active second factor, password change, deleting a passkey and
 * changing the email additionally require a code (confirmWithFactor in
 * src/account/http/login.ts). A missing code is rejected before
 * anything is checked; a wrong one counts in the brake. Without a second factor …
 *
 * Counter-checks (measured 01.11.2026, each on its own):
 *   A  change-password again with bestaetigePasswort without a code → red:
 *      „Passwortwechsel ohne Code" (the following parts too, the password is new)
 *   B  DELETE /passkeys/:id without a code → red: „Passkey löschen ohne Code"
 *   C  PUT /profile (email) without a code → red: „E-Mail ändern"
 *   D  in confirmWithFactor the refusal for a missing code removed (the
 *      code goes empty into the check) → red: the three „ohne Code" and
 *      „fehlender Code zählt nicht in der Bremse" (429 instead of 200)
 *   E  `felder.email_verified = user.is_admin` back → red: “admin
 *      address only applies after the link” (since 04.11.2026 via new_email,
 *      counter-checks for it in email-new-db)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerServer } = require('./helpers/server');

// No real mails: replace before loading routes/auth.
require('./helpers/sources').replaceServices('mail', {
  mailEmailChanged: async () => ({ success: true }),
  mailVerification: async () => ({ success: true }),
});

const db = S.testData();
const zf = _req('src/factors/secondFactor.js');
const { decrypt } = _req('src/infra/secret.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Faktor-Passwort-1';

async function account(name, { admin = false } = {}) {
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  return (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
      [name, `${name}@alt.example`, await bcrypt.hash(PASS, 4), admin],
    )
  ).id;
}

/** Switch on the second factor; delivers the recovery codes. */
async function withFactor(uid) {
  await zf.beginSetup(uid);
  const z = await db.get('SELECT secret FROM second_factor WHERE user_id = $1', [uid]);
  const code = zf.hotp(zf.fromBase32(decrypt(z.secret, zf.secondFactorContext(uid))), zf.timeStep());
  const codes = await zf.confirmSetup(uid, code);
  assert.ok(Array.isArray(codes) && codes.length >= 3, 'precondition: factor active');
  return codes;
}

test('sensitive account changes with second factor', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `zfh_${process.pid}`,
    WITHOUT = `zfh_ohne_${process.pid}`,
    CHEF = `zfh_chef_${process.pid}`;
  const uid = await account(NAME),
    without = await account(WITHOUT),
    chef = await account(CHEF, { admin: true });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, without, chef]]).catch(() => {});
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'bestaetigung|%'`).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const codes = await withFactor(uid);

  const server = (id, name, admin = false) =>
    routerServer(_req, {
      session: { userId: id, username: name, isAdmin: admin },
      routes: { '/api/v2/auth': 'routes/auth.js' },
      t,
    }).base;
  const basis = server(uid, NAME);
  const callFn = async (b, method, route, body) => {
    const r = await fetch(`${b}/api/v2/auth${route}`, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('password change', async () => {
    const withoutCode = await callFn(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-22',
    });
    assert.equal(withoutCode.body.code, 'second_factor_required', 'password change without a code');
    assert.equal(withoutCode.status, 400);
    const wrong = await callFn(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-22',
      code: '000000',
    });
    assert.equal(wrong.body.code, 'second_factor_wrong');
    const good = await callFn(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-22',
      code: codes[0],
    });
    assert.equal(good.status, 200, JSON.stringify(good.body));
    // Back, so that the following parts take the same password.
    await db.run('UPDATE users SET password_hash = $2 WHERE id = $1', [uid, await bcrypt.hash(PASS, 4)]);
  });

  await t.test('delete passkey', async () => {
    const pk = (
      await db.get(
        `INSERT INTO passkeys (user_id, credential_id, public_key, name)
      VALUES ($1, $2, '\\x00', 'Probe') RETURNING id`,
        [uid, `zfh-${process.pid}`],
      )
    ).id;
    const withoutCode = await callFn(basis, 'DELETE', `/passkeys/${pk}`, { password: PASS });
    assert.equal(withoutCode.body.code, 'second_factor_required', 'deleting a passkey without a code');
    assert.ok(await db.get('SELECT 1 FROM passkeys WHERE id = $1', [pk]), 'the passkey is still there');
    const good = await callFn(basis, 'DELETE', `/passkeys/${pk}`, { password: PASS, code: codes[1] });
    assert.equal(good.body.deleted, 1, JSON.stringify(good.body));
  });

  await t.test('change e-mail', async () => {
    const withoutCode = await callFn(basis, 'PUT', '/profile', {
      username: NAME,
      email: `${NAME}@neu.example`,
      password_current: PASS,
    });
    assert.equal(withoutCode.body.code, 'second_factor_required', 'changing the email without a code');
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [uid])).email, `${NAME}@alt.example`);
    const good = await callFn(basis, 'PUT', '/profile', {
      username: NAME,
      email: `${NAME}@neu.example`,
      password_current: PASS,
      code: codes[2],
    });
    assert.equal(good.status, 200, JSON.stringify(good.body));
    assert.equal((await db.get('SELECT new_email FROM users WHERE id = $1', [uid])).new_email, `${NAME}@neu.example`);
  });

  await t.test('missing code does not count in the brake', async () => {
    for (let i = 0; i < 7; i++)
      assert.equal(
        (await callFn(basis, 'POST', '/change-password', { current: PASS, newPassword: 'Neues-Passwort-33' })).status,
        400,
      );
    const good = await callFn(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-33',
      code: codes[3],
    });
    assert.equal(good.status, 200, `a missing code does not count in the throttle: ${JSON.stringify(good.body)}`);
  });

  await t.test('without second factor as before', async () => {
    const r = await callFn(server(without, WITHOUT), 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-44',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test('administrator address only applies after the link', async () => {
    const r = await callFn(server(chef, CHEF, true), 'PUT', '/profile', {
      username: CHEF,
      email: `${CHEF}@neu.example`,
      password_current: PASS,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const z = await db.get('SELECT email, new_email FROM users WHERE id = $1', [chef]);
    assert.deepEqual(
      [z.email, z.new_email],
      [`${CHEF}@alt.example`, `${CHEF}@neu.example`],
      'the admin address only applies after the link',
    );
  });
});
