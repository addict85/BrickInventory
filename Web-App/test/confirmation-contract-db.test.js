/**
 * A single confirmation path: every route with `bestaetigung` in the API contract
 * requires the code (or a passkey) when a second factor is active, even with
 * the administrator's correct password. Every route that accepts a password for
 * confirmation carries the marker; a route without the marker that still
 * confirms answers 500 in tests.
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  in checkConfirmation `withFactor = false` (password only, the old
 *      finding M1) → red: “… without code" for all marked routes
 *   B  in the contract the marker of DELETE /api/v2/bestand removed → red: “the
 *      mandatory routes carry the marker"
 *   C  in the contract DELETE /users/:id with `eingabe: { admin_password }` instead of
 *      adminConfirmed() → red: “every password input carries the marker"
 *   D  in confirmWithFactor the check for the marker removed → red:
 *      “without marker no confirmation"
 *   E  in routes/api/trash.ts an own bcrypt.compare( → red:
 *      “no second path to password comparison"
 *   F  (05.11.2026) in NurCode (konto.ts) `password: txtLeer(…)` instead of
 *      `z.null()` → red: “every password input carries the marker"
 *   G  (09.11.2026) DELETE /settings/tokens/:tokenId again with
 *      `eingabe: WITHOUT_BODY` instead of bestaetigt() → red: “the mandatory routes
 *      carry the marker"
 *   H  (15.11.2026) in routes/api/trash.ts `import { verify } from
 *      '@node-rs/argon2'` → red: “no second path to password comparison"
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
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const zf = _req('src/factors/secondFactor.js');
const { CONTRACT } = _req('src/contract/index.js');
const { decrypt } = _req('src/infra/secret.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Vertrag-Passwort-1';

/** What a route needs besides password and code to get as far as the confirmation. */
const EXTRA = {
  'POST /api/v2/auth/users': { username: `bv_neu_${process.pid}`, password: 'Lang-genug-Passwort-1', is_admin: true },
  'PUT /api/v2/auth/users/:id/admin': { is_admin: true },
  'PUT /api/v2/auth/users/:id/active': { is_active: false },
  'PUT /api/v2/auth/users/:id/password': { password: 'Lang-genug-Passwort-2' },
  'POST /api/v2/auth/change-password': { newPassword: 'Lang-genug-Passwort-3' },
  'PUT /api/v2/auth/profile': { email: `bv_${process.pid}@neu.example` },
  'POST /api/v2/settings/household/redeem': { code: 'EINLADUNG' },
  'POST /api/v2/settings': { smtp_host: 'mail.bv.example' },
  'POST /api/v2/settings/smtp-test': { to: 'fremd@bv.example' },
};
/** Mint new accesses, remove protection, delete everything (report M1) — and the emergency brake. */
const PFLICHT = [
  'POST /api/v2/auth/token-create',
  'POST /api/v2/auth/qr-token',
  'POST /api/v2/auth/users',
  'PUT /api/v2/auth/users/:id/admin',
  'PUT /api/v2/auth/users/:id/active',
  'PUT /api/v2/auth/users/:id/password',
  'DELETE /api/v2/auth/users/:id',
  'DELETE /api/v2/auth/users/:id/second-factor',
  'DELETE /api/v2/inventory',
  'POST /api/v2/auth/change-password',
  'PUT /api/v2/auth/profile',
  'DELETE /api/v2/auth/passkeys/:id',
  'POST /api/v2/auth/passkey/register/options',
  'POST /api/v2/auth/second-factor/disable',
  'POST /api/v2/settings/household/redeem',
  'POST /api/v2/settings',
  'POST /api/v2/settings/sessions/end-others',
  'DELETE /api/v2/settings/tokens/:tokenId',
  'DELETE /api/v2/trash',
  'DELETE /api/v2/trash/:id',
  'DELETE /api/v2/vouchers/:id',
  'POST /api/v2/vouchers/:id/plaintext',
  'POST /api/v2/vouchers/:id/pdf-grant',
  'POST /api/v2/vouchers/export/pdf-grant',
];
/** Before login there is nothing to confirm. */
const PUBLIC = ['POST /api/v2/auth/login', 'POST /api/v2/auth/register', 'POST /api/v2/auth/reset-password'];
const PASSWORD_FIELDS = ['password', 'admin_password', 'current', 'password_current'];

async function konto(name, admin) {
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
  return codes;
}

test('one single confirmation path', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const CHEF = `bv_chef_${process.pid}`,
    ZIEL = `bv_ziel_${process.pid}`,
    OHNE = `bv_ohne_${process.pid}`;
  const chef = await konto(CHEF, true),
    ziel = await konto(ZIEL, false),
    ohne = await konto(OHNE, false);
  t.after(async () => {
    await db
      .run('DELETE FROM users WHERE id = ANY($1) OR username = $2', [
        [chef, ziel, ohne],
        EXTRA['POST /api/v2/auth/users'].username,
      ])
      .catch(() => {});
    await db.run("DELETE FROM global_settings WHERE key = 'smtp_host' AND value = 'mail.bv.example'").catch(() => {});
    await db
      .run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2 OR key LIKE $3', [
        `%-bestaetigen|${chef}|%`,
        `%-bestaetigen|${ohne}|%`,
        `%-bestaetigen-konto|${chef}`,
      ])
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const codes = await withFactor(chef);
  await withFactor(ziel);
  const basis = testServer(_req, { sitzung: { userId: chef, username: CHEF, isAdmin: true }, t }).base;
  const callFn = async (b, schluessel, body) => {
    const [methode, muster] = schluessel.split(' ');
    const r = await fetch(b + muster.replace(':id', String(ziel)).replace(':tokenId', '0123456789abcdef'), {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const markiert = Object.entries(CONTRACT).filter(([, r]) => r.confirmation);

  await t.test('the mandatory routes carry the brand', () => {
    const fehlt = PFLICHT.filter(k => !CONTRACT[k]?.confirmation);
    assert.deepEqual(fehlt, []);
  });

  await t.test('every password input carries the brand', () => {
    const withoutBrand = Object.entries(CONTRACT)
      .filter(
        ([k, r]) =>
          !PUBLIC.includes(k) &&
          !r.confirmation &&
          r.input?.shape &&
          PASSWORD_FIELDS.some(f => r.input.shape[f]?.safeParse('x').success),
      )
      .map(([k]) => k);
    assert.deepEqual(withoutBrand, []);
  });

  for (const [schluessel, route] of markiert) {
    await t.test(`${schluessel}: password alone is not enough`, async () => {
      // The account brake too (20 a day): here one session deliberately guesses wrong on every route.
      await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [
        `%-bestaetigen|${chef}|%`,
        `%-bestaetigen-konto|${chef}`,
      ]);
      const { password: passwort, code } = route.confirmation;
      const rumpf = { ...EXTRA[schluessel], [passwort]: PASS };
      const withoutCode = await callFn(basis, schluessel, rumpf);
      assert.deepEqual(
        [withoutCode.status, withoutCode.body.code],
        [400, 'second_factor_required'],
        `${schluessel} without a code`,
      );
      const falsch = await callFn(basis, schluessel, { ...rumpf, [code]: '000000' });
      assert.deepEqual(
        [falsch.status, falsch.body.code],
        [400, 'second_factor_wrong'],
        `${schluessel} with a wrong code`,
      );
    });
  }
  assert.ok(markiert.length >= PFLICHT.length, `only ${markiert.length} marked routes`);

  await t.test('with code it works, without a factor as before', async () => {
    const r = await callFn(basis, 'DELETE /api/v2/auth/users/:id/second-factor', {
      admin_password: PASS,
      code: codes[0],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.effective_at, 'announced, not immediate');
    assert.equal(await require('./helpers/admin').takeoverNow(_req, db, ziel), 1);
    assert.equal(await zf.isActive(ziel), false);
    const withoutFactor = testServer(_req, { sitzung: { userId: ohne, username: OHNE }, t }).base;
    const tok = await callFn(withoutFactor, 'POST /api/v2/auth/token-create', { password: PASS });
    assert.equal(tok.status, 200, JSON.stringify(tok.body));
  });

  await t.test('no second path to the password comparison', () => {
    const fs = require('node:fs');
    const { ohneKommentare } = require('./helpers/sources');
    const ordner = [path.join(ROOT, 'routes'), path.join(ROOT, 'src'), path.join(ROOT, 'jobs')];
    const dateien = ordner
      .flatMap(o => fs.readdirSync(o, { recursive: true }).map(f => path.resolve(o, String(f))))
      .filter(f => f.endsWith('.ts'))
      .concat(path.join(ROOT, 'server.ts'));
    const treffer = dateien
      .filter(f => /\bbcrypt\.compare\(/.test(ohneKommentare(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(ROOT, f).replace(/\\/g, '/'))
      .sort();
    assert.deepEqual(
      treffer,
      ['src/account/bcryptPool.ts'],
      'only the fallback of the pool; all others via passwordFits()',
    );
    // argon2 verify() would likewise bypass login and confirmation.
    const argon2 = dateien
      .filter(f => /['"]@node-rs\/argon2['"]/.test(ohneKommentare(fs.readFileSync(f, 'utf8'))))
      .map(f => path.relative(ROOT, f).replace(/\\/g, '/'));
    assert.deepEqual(argon2, ['src/account/passwordHash.ts'], 'argon2 only via passwordFits()/hashPassword()');
  });

  await t.test('no confirmation without the brand', async () => {
    const route = CONTRACT['DELETE /api/v2/inventory'];
    const marke = route.confirmation;
    delete route.confirmation;
    try {
      const r = await callFn(basis, 'DELETE /api/v2/inventory', { password: PASS, code: codes[1] });
      assert.equal(r.status, 500, `no confirmation without a marker: ${JSON.stringify(r.body)}`);
    } finally {
      route.confirmation = marke;
    }
  });
});
