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

async function konto(name, { admin = false } = {}) {
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
  assert.ok(Array.isArray(codes) && codes.length >= 3, 'Vorbedingung: Faktor active');
  return codes;
}

test('sensitive account changes with second factor', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `zfh_${process.pid}`,
    OHNE = `zfh_ohne_${process.pid}`,
    CHEF = `zfh_chef_${process.pid}`;
  const uid = await konto(NAME),
    ohne = await konto(OHNE),
    chef = await konto(CHEF, { admin: true });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, ohne, chef]]).catch(() => {});
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'bestaetigung|%'`).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const codes = await withFactor(uid);

  const server = (id, name, admin = false) =>
    routerServer(_req, {
      sitzung: { userId: id, username: name, isAdmin: admin },
      routen: { '/api/v1/auth': 'routes/auth.js' },
      t,
    }).base;
  const basis = server(uid, NAME);
  const ruf = async (b, methode, weg, body) => {
    const r = await fetch(`${b}/api/v1/auth${weg}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('password change', async () => {
    const withoutCode = await ruf(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-22',
    });
    assert.equal(withoutCode.body.code, 'zweiter_faktor_noetig', 'Passwortwechsel ohne Code');
    assert.equal(withoutCode.status, 400);
    const falsch = await ruf(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-22',
      code: '000000',
    });
    assert.equal(falsch.body.code, 'zweiter_faktor_falsch');
    const gut = await ruf(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-22',
      code: codes[0],
    });
    assert.equal(gut.status, 200, JSON.stringify(gut.body));
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
    const withoutCode = await ruf(basis, 'DELETE', `/passkeys/${pk}`, { password: PASS });
    assert.equal(withoutCode.body.code, 'zweiter_faktor_noetig', 'Passkey löschen ohne Code');
    assert.ok(await db.get('SELECT 1 FROM passkeys WHERE id = $1', [pk]), 'der Passkey steht noch');
    const gut = await ruf(basis, 'DELETE', `/passkeys/${pk}`, { password: PASS, code: codes[1] });
    assert.equal(gut.body.deleted, 1, JSON.stringify(gut.body));
  });

  await t.test('change e-mail', async () => {
    const withoutCode = await ruf(basis, 'PUT', '/profile', {
      username: NAME,
      email: `${NAME}@neu.example`,
      password_current: PASS,
    });
    assert.equal(withoutCode.body.code, 'zweiter_faktor_noetig', 'E-Mail ändern ohne Code');
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [uid])).email, `${NAME}@alt.example`);
    const gut = await ruf(basis, 'PUT', '/profile', {
      username: NAME,
      email: `${NAME}@neu.example`,
      password_current: PASS,
      code: codes[2],
    });
    assert.equal(gut.status, 200, JSON.stringify(gut.body));
    assert.equal((await db.get('SELECT new_email FROM users WHERE id = $1', [uid])).new_email, `${NAME}@neu.example`);
  });

  await t.test('missing code does not count in the brake', async () => {
    for (let i = 0; i < 7; i++)
      assert.equal(
        (await ruf(basis, 'POST', '/change-password', { current: PASS, newPassword: 'Neues-Passwort-33' })).status,
        400,
      );
    const gut = await ruf(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-33',
      code: codes[3],
    });
    assert.equal(gut.status, 200, `fehlender Code zählt nicht in der Bremse: ${JSON.stringify(gut.body)}`);
  });

  await t.test('without second factor as before', async () => {
    const r = await ruf(server(ohne, OHNE), 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-44',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test('administrator address only applies after the link', async () => {
    const r = await ruf(server(chef, CHEF, true), 'PUT', '/profile', {
      username: CHEF,
      email: `${CHEF}@neu.example`,
      password_current: PASS,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const z = await db.get('SELECT email, new_email FROM users WHERE id = $1', [chef]);
    assert.deepEqual(
      [z.email, z.new_email],
      [`${CHEF}@alt.example`, `${CHEF}@neu.example`],
      'Verwalter-Adresse gilt erst nach dem Link',
    );
  });
});
