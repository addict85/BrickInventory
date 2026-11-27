/**
 * With an active second factor, password change, deleting a passkey and changing
 * the e-mail need only the login, neither password nor code (docs/SICHERHEIT.md).
 * A new address, the administrator's too, only applies after its link.
 *
 * Counter-checks (measured 26.11.2026, each on its own):
 *   A  a password check back into change-password → red: “password change”
 *   B  a password check back into DELETE /passkeys/:id → red: “delete passkey”
 *   C  a password check back into PUT /profile → red: “change e-mail”
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

test('sensitive account changes with second factor need only the login', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `zfh_${process.pid}`,
    CHEF = `zfh_chef_${process.pid}`;
  const uid = await account(NAME),
    chef = await account(CHEF, { admin: true });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, chef]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await withFactor(uid);

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
    const r = await callFn(basis, 'POST', '/change-password', { newPassword: 'Neues-Passwort-22' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test('delete passkey', async () => {
    const pk = (
      await db.get(
        `INSERT INTO passkeys (user_id, credential_id, public_key, name)
      VALUES ($1, $2, '\\x00', 'Probe') RETURNING id`,
        [uid, `zfh-${process.pid}`],
      )
    ).id;
    const r = await callFn(basis, 'DELETE', `/passkeys/${pk}`, {});
    assert.equal(r.body.deleted, 1, JSON.stringify(r.body));
  });

  await t.test('change e-mail', async () => {
    const r = await callFn(basis, 'PUT', '/profile', { username: NAME, email: `${NAME}@neu.example` });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await db.get('SELECT new_email FROM users WHERE id = $1', [uid])).new_email, `${NAME}@neu.example`);
  });

  await t.test('administrator address only applies after the link', async () => {
    const r = await callFn(server(chef, CHEF, true), 'PUT', '/profile', {
      username: CHEF,
      email: `${CHEF}@neu.example`,
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
