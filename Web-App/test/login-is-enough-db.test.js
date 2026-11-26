/**
 * A login is enough: inside the signed-in area no route asks again for the
 * password or the second factor (owner's decision, docs/SICHERHEIT.md). Every route
 * that used to confirm runs for an administrator WITH an active second factor and
 * a body without password and code; without a session it stays 401. The fields
 * older apps still send are accepted and ignored.
 *
 * Counter-checks (measured 26.11.2026, each alone):
 *   A  a password check back into DELETE /api/v2/trash (routes/api/trash.ts) → red:
 *      “DELETE /api/v2/trash runs without password and code” (400 second_factor_required)
 *   B  in change-password `if (!current) failDomain(…)` again → red:
 *      “change-password without the old password” (400 all_fields_required)
 *   C  requireToken removed from DELETE /api/v2/trash → stays green: the login
 *      guard in front of the API routers answers 401 already (measured)
 *   D  `password` dropped from legacyConfirmation() in the contract → red:
 *      “an old app's password field is ignored” (400 contract_violated)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
// QR codes and passkeys need the server's own address.
process.env.APP_BASE_URL = 'https://inventar.example.org';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const zf = _req('src/factors/secondFactor.js');
const { decrypt } = _req('src/infra/secret.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Anmeldung-genuegt-1';

/** The answers the removed re-confirmation gave; none may come back. */
const CONFIRMATION_CODES = [
  'current_password_required',
  'current_password_wrong',
  'second_factor_required',
  'second_factor_wrong',
];

/** Every route that used to confirm, with what it needs besides password and code. */
const ROUTES = {
  'POST /api/v2/auth/token-create': { label: 'Probe', scope: 'app' },
  'POST /api/v2/auth/qr-token': {},
  'POST /api/v2/auth/users': { username: `le_neu_${process.pid}`, password: 'Lang-genug-Passwort-1' },
  'PUT /api/v2/auth/users/:id/admin': { is_admin: true },
  'PUT /api/v2/auth/users/:id/active': { is_active: false },
  'PUT /api/v2/auth/users/:id/approve': {},
  'PUT /api/v2/auth/users/:id/password': { password: 'Lang-genug-Passwort-2' },
  'DELETE /api/v2/auth/users/:id/second-factor': {},
  'DELETE /api/v2/auth/users/:id': {},
  'PUT /api/v2/auth/profile': { username: `le_chef_${process.pid}`, email: `le_${process.pid}@neu.example` },
  'DELETE /api/v2/auth/passkeys/:id': {},
  'POST /api/v2/auth/passkey/register/options': {},
  'POST /api/v2/auth/second-factor/codes': {},
  'POST /api/v2/settings/household/redeem': { code: 'EINLADUNG' },
  'POST /api/v2/settings': { smtp_host: 'mail.le.example' },
  'POST /api/v2/settings/smtp-test': { to: 'fremd@le.example' },
  'DELETE /api/v2/settings/tokens/:tokenId': {},
  'DELETE /api/v2/trash/:id': {},
  'DELETE /api/v2/trash': {},
  'DELETE /api/v2/inventory': {},
  'POST /api/v2/vouchers/:id/plaintext': {},
  'POST /api/v2/vouchers/:id/pdf-grant': {},
  'POST /api/v2/vouchers/export/pdf-grant': {},
  'DELETE /api/v2/vouchers/:id': {},
  'POST /api/v2/settings/sessions/end-others': { accesses: true },
  'POST /api/v2/auth/change-password': { newPassword: 'Lang-genug-Passwort-3' },
  'POST /api/v2/auth/second-factor/disable': {},
};

async function account(name, admin) {
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  return (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
      [name, `${name}@alt.example`, await bcrypt.hash(PASS, 4), admin],
    )
  ).id;
}
async function withFactor(uid) {
  await zf.beginSetup(uid);
  const z = await db.get('SELECT secret FROM second_factor WHERE user_id = $1', [uid]);
  const codes = await zf.confirmSetup(
    uid,
    zf.hotp(zf.fromBase32(decrypt(z.secret, zf.secondFactorContext(uid))), zf.timeStep()),
  );
  assert.ok(Array.isArray(codes), 'Precondition: factor active');
}

test('a login is enough', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const CHEF = `le_chef_${process.pid}`,
    TARGET = `le_ziel_${process.pid}`;
  const chef = await account(CHEF, true),
    target = await account(TARGET, false);
  t.after(async () => {
    await db
      .run('DELETE FROM users WHERE id = ANY($1) OR username = $2', [
        [chef, target],
        ROUTES['POST /api/v2/auth/users'].username,
      ])
      .catch(() => {});
    await db.run("DELETE FROM global_settings WHERE key = 'smtp_host' AND value = 'mail.le.example'").catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await withFactor(chef);
  await withFactor(target);
  await db.run('UPDATE users SET email_verified = false WHERE id = $1', [target]);
  const signedIn = testServer(_req, { session: { userId: chef, username: CHEF, isAdmin: true }, t }).base;
  const anonymous = testServer(_req, { t }).base;
  const callFn = async (b, key, body) => {
    const [method, pattern] = key.split(' ');
    const url = pattern.replace(':id', String(target)).replace(':tokenId', '0123456789abcdef');
    const r = await fetch(b + url, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  for (const key of Object.keys(ROUTES)) {
    await t.test(`${key} without a session`, async () => {
      const r = await callFn(anonymous, key, ROUTES[key]);
      assert.equal(r.status, 401, `${key}: ${JSON.stringify(r.body)}`);
    });
  }

  await t.test('change-password without the old password', async () => {
    const r = await callFn(signedIn, 'POST /api/v2/auth/change-password', { newPassword: 'Lang-genug-Passwort-4' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test("an old app's password field is ignored", async () => {
    const r = await callFn(signedIn, 'DELETE /api/v2/trash', { password: 'falsch', code: '000000' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  // In this order: changing the password and ending the own factor come last, they change the account.
  const answers = {};
  for (const [key, body] of Object.entries(ROUTES)) {
    await t.test(`${key} runs without password and code`, async () => {
      const r = await callFn(signedIn, key, body);
      answers[key] = r.body;
      assert.ok(!CONFIRMATION_CODES.includes(r.body.code), `${key} asks again: ${JSON.stringify(r.body)}`);
      assert.notEqual(r.status, 401, `${key}: ${JSON.stringify(r.body)}`);
      assert.ok(r.status < 500, `${key}: ${JSON.stringify(r.body)}`);
    });
  }

  await t.test('the steps take effect', async () => {
    assert.ok(answers['POST /api/v2/auth/token-create']?.token, 'token-create minted a token');
    assert.ok(answers['POST /api/v2/auth/qr-token']?.success, 'qr-token created a code');
    const u = await db.get('SELECT new_email FROM users WHERE id = $1', [chef]);
    assert.equal(u.new_email, `le_${process.pid}@neu.example`, 'the new address waits for its link');
    assert.equal(await zf.isActive(chef), false, 'the own second factor is off');
    const hash = (await db.get('SELECT password_hash FROM users WHERE id = $1', [chef])).password_hash;
    const { passwordFits } = _req('src/account/passwordHash.js');
    assert.equal(await passwordFits('Lang-genug-Passwort-3', hash), true, 'the new password applies');
  });

  await t.test('no second path to the password comparison', () => {
    const fs = require('node:fs');
    const { withoutComments } = require('./helpers/sources');
    const dir = [path.join(ROOT, 'routes'), path.join(ROOT, 'src'), path.join(ROOT, 'jobs')];
    const files = dir
      .flatMap(o => fs.readdirSync(o, { recursive: true }).map(f => path.resolve(o, String(f))))
      .filter(f => f.endsWith('.ts'))
      .concat(path.join(ROOT, 'server.ts'));
    const hits = files
      .filter(f => /\bbcrypt\.compare\(/.test(withoutComments(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(ROOT, f).replace(/\\/g, '/'))
      .sort();
    assert.deepEqual(
      hits,
      ['src/account/bcryptPool.ts'],
      'only the fallback of the pool; all others via passwordFits()',
    );
    // argon2 verify() would likewise bypass the login.
    const argon2 = files
      .filter(f => /['"]@node-rs\/argon2['"]/.test(withoutComments(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(ROOT, f).replace(/\\/g, '/'));
    assert.deepEqual(argon2, ['src/account/passwordHash.ts'], 'argon2 only via passwordFits()/hashPassword()');
  });
});
