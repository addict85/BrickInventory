/**
 * Second factor (TOTP, RFC 6238) — calculation against the RFC test vectors and
 * the whole flow via the real login.
 *
 * Counter-checks (25.10., measured):
 *   A  istAktiv check removed in checkCredentials() → red: „ohne Code angemeldet"
 *   B  `last_step < $2` removed in pruefeCode()     → red: „derselbe Code zweimal"
 *   C  loginFailed removed for the wrong code      → red: „keine Sperre"
 *   D  hotp(): offset from the first instead of the last byte → red: RFC vectors
 *   F  (28.10.) beendeAndereZugaenge() removed on confirming → red: „Ein
 *      Token von vor dem Einschalten gilt weiter"
 *   H  (01.11.) hashCode() again as bare SHA-256 → red: „ungesalzenes SHA-256";
 *      randomBytes(7)/10 characters → red: format; fallback to alterHash removed → red:
 *      „alter Code gilt nicht mehr"
 *   I  (01.11.) /zweiter-faktor/bestaetigen again directly via zf.confirmSetup →
 *      red: „Einrichtungscode beliebig oft ratbar"
 *   J  (02.11.) in DELETE /users/:id/zweiter-faktor the check for the own account
 *      removed → red: „own factor removed only with a password“
 *   K  (26.11.2026) a password check back into /second-factor/disable → red:
 *      “switching off needs only the login” (400 instead of 200)
 * Setting up, switching off and new recovery codes need no password or code
 * inside the session (docs/SICHERHEIT.md); the login itself still asks for the code.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const zf = _req('src/factors/secondFactor.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('RFC 6238: the test vectors for SHA-1', () => {
  // Appendix B of the RFC: key "12345678901234567890", eight digits.
  const key = Buffer.from('12345678901234567890');
  for (const [seconds, expected] of /** @type {[number, string][]} */ ([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])) {
    assert.equal(zf.hotp(key, Math.floor(seconds / 30), 8), expected, `T=${seconds}`);
  }
  // And Base32 there and back, as an authenticator app reads it.
  assert.equal(zf.base32(key), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(zf.fromBase32('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), key);
});

test('passenderSchritt: one step of leeway, no more', () => {
  const g = zf.base32(Buffer.from('12345678901234567890'));
  const now = 1234567890 * 1000,
    s = zf.timeStep(now),
    k = zf.fromBase32(g);
  assert.equal(zf.matchingStep(g, zf.hotp(k, s), now), s);
  assert.equal(zf.matchingStep(g, zf.hotp(k, s - 1), now), s - 1);
  assert.equal(zf.matchingStep(g, zf.hotp(k, s + 1), now), s + 1);
  assert.equal(zf.matchingStep(g, zf.hotp(k, s - 2), now), null);
  assert.equal(zf.matchingStep(g, 'abcdef', now), null);
});

test('login with second factor — played through', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `zf_${process.pid}`,
    PASS = 'richtigesPasswort1';
  const LOCK = `zf_sperre_${process.pid}`,
    BRAKE = `zf_bremse_${process.pid}`,
    ADMINISTRATOR = `zf_verw_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, LOCK, BRAKE, ADMINISTRATOR]]);
  for (const n of [NAME, LOCK, BRAKE])
    await db.run('INSERT INTO users (username,password_hash,is_active,email_verified) VALUES ($1,$2,true,true)', [
      n,
      await bcrypt.hash(PASS, 4),
    ]);

  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: _req('src/account/sessionStore.js').hashSessionIds(
        new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      ),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://localhost:${srv.address().port}${AUTH}`;
  const callFn = async (route, body, token) => {
    const r = await fetch(basis + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const signIn = (name, code) =>
    callFn('/login', { username: name, password: PASS, ...(code !== undefined ? { code } : {}) });
  /** A code that matches the current secret — optionally offset by one step. */
  const codeFor = async (name, offset = 0) => {
    const z = await db.get(
      'SELECT f.user_id, f.secret FROM second_factor f JOIN users u ON u.id = f.user_id WHERE u.username = $1',
      [name],
    );
    return zf.hotp(
      zf.fromBase32(_req('src/infra/secret.js').decrypt(z.secret, zf.secondFactorContext(z.user_id))),
      zf.timeStep() + offset,
    );
  };
  /** Set up until active; returns the token and the recovery codes. */
  const setUpAccount = async name => {
    const token = (await signIn(name)).body.token;
    const e = await callFn('/second-factor/setup', {}, token);
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.match(e.body.otpauth, /^otpauth:\/\/totp\/BrickInventory%3A/);
    // Before the confirmation the factor does not apply: logging in still works without a code.
    assert.equal((await signIn(name)).status, 200, 'an unconfirmed setup already locks');
    assert.equal((await callFn('/second-factor/confirm', { code: '000000' }, token)).status, 400);
    const b = await callFn('/second-factor/confirm', { code: await codeFor(name, -1) }, token);
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(b.body.codes.length, 10);
    return { token, codes: b.body.codes };
  };

  try {
    // An access from before — after switching on it must be gone.
    const alt = (await signIn(NAME)).body.token;
    const { token, codes } = await setUpAccount(NAME);
    assert.equal(
      (await callFn('/second-factor', null, alt)).status,
      401,
      'A token from before enabling stays valid — an intruder would stay in',
    );
    assert.deepEqual((await callFn('/second-factor', null, token)).body, {
      success: true,
      active: true,
      codes_left: 10,
      // Freshly generated codes are of the new kind and carry no deadline (migration 0122).
      old_codes_until: null,
    });
    const raw = JSON.stringify(await db.all('SELECT code_hash FROM second_factor_codes'));
    assert.ok(!codes.some(c => raw.includes(c.replace(/-/g, ''))), 'recovery codes are stored in plain text');
    // 80 bits: 16 Base32 characters in groups of four; stored as HMAC, not as bare SHA-256.
    for (const c of codes) assert.match(c, /^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);
    const sha = c => require('node:crypto').createHash('sha256').update(c.replace(/-/g, '')).digest('hex');
    assert.ok(!codes.some(c => raw.includes(sha(c))), 'recovery codes stored as unsalted SHA-256');
    // A code of the old form (10 characters, SHA-256) applies until its deadline (0122), once.
    const uid = (await db.get('SELECT id FROM users WHERE username = $1', [NAME])).id;
    await db.run(
      `INSERT INTO second_factor_codes (user_id, code_hash, old_valid_until) VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
      [uid, sha('abcde23456')],
    );
    assert.equal(await zf.checkCode(uid, 'abcde-23456'), 'wiederherstellung_alt', 'old code no longer valid');
    assert.equal(await zf.checkCode(uid, 'abcde-23456'), null, 'old code valid twice');
    await db.run('DELETE FROM second_factor_codes WHERE user_id = $1 AND consumed_at IS NOT NULL', [uid]);

    // Without a code: refusal with a hint, no token.
    const without = await signIn(NAME);
    assert.equal(without.status, 401);
    assert.equal(without.body.second_factor, true, 'logged in without a code');
    assert.equal(without.body.code, 'second_factor_required');
    assert.equal(without.body.token, undefined);

    // With a code: logged in. The same code a second time: rejected.
    const code = await codeFor(NAME);
    const withIt = await signIn(NAME, code);
    assert.equal(withIt.status, 200, JSON.stringify(withIt.body));
    assert.ok(withIt.body.token);
    const again = await signIn(NAME, code);
    assert.equal(again.status, 401, 'the same code twice');
    assert.equal(again.body.code, 'second_factor_wrong');

    // Recovery code: applies once, even with a different notation.
    assert.equal((await signIn(NAME, codes[0].toUpperCase().replace('-', ' '))).status, 200);
    assert.equal((await signIn(NAME, codes[0])).status, 401, 'recovery code valid twice');
    assert.equal((await callFn('/second-factor', null, token)).body.codes_left, 9);

    assert.equal((await callFn('/second-factor/disable', {}, token)).status, 200, 'switching off needs only the login');
    assert.equal((await signIn(NAME)).status, 200, 'after disabling, without a code again');
    assert.equal(
      (
        await db.get(
          'SELECT COUNT(*)::int n FROM second_factor_codes f JOIN users u ON u.id=f.user_id WHERE u.username=$1',
          [NAME],
        )
      ).n,
      0,
    );

    // Wrong codes count as failed attempts: afterwards even the right one does not help.
    const { token: tS, codes: cS } = await setUpAccount(LOCK);
    for (let i = 0; i < 5; i++) await signIn(LOCK, String(100000 + i));
    const locked = await signIn(LOCK, await codeFor(LOCK));
    assert.equal(locked.status, 429, `no lock after five wrong codes: ${JSON.stringify(locked.body)}`);
    // New recovery codes need only the login, too; the old ones stop applying.
    const fresh = await callFn('/second-factor/codes', {}, tS);
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.equal(fresh.body.codes.length, 10);
    assert.ok(!fresh.body.codes.includes(cS[0]), 'the old codes are renewed');

    // Confirming the setup throttles just the same.
    const tB = (await signIn(BRAKE)).body.token;
    assert.equal((await callFn('/second-factor/setup', {}, tB)).status, 200);
    for (let i = 0; i < 5; i++) await callFn('/second-factor/confirm', { code: String(300000 + i) }, tB);
    const late = await callFn('/second-factor/confirm', { code: await codeFor(BRAKE) }, tB);
    assert.equal(late.status, 429, `Einrichtungscode beliebig oft ratbar: ${late.status}`);

    // The admin's emergency exit only applies to foreign accounts: for the own one
    // an open session including the password would otherwise suffice, without any code.
    await db.run(
      'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
      [ADMINISTRATOR, await bcrypt.hash(PASS, 4)],
    );
    await setUpAccount(ADMINISTRATOR);
    const sess = await fetch(`${basis}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: ADMINISTRATOR,
        password: PASS,
        code: await codeFor(ADMINISTRATOR),
        without_token: true,
      }),
    });
    assert.equal(sess.status, 200);
    const keks = (sess.headers.get('set-cookie') || '').split(';')[0];
    const idV = (await db.get('SELECT id FROM users WHERE username = $1', [ADMINISTRATOR])).id;
    const idS = (await db.get('SELECT id FROM users WHERE username = $1', [LOCK])).id;
    const remove = async id => {
      const r = await fetch(`${basis}/users/${id}/second-factor`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie: keks },
        body: JSON.stringify({}),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const own = await remove(idV);
    assert.deepEqual(
      [own.status, own.body?.code],
      [400, 'own_second_factor'],
      'own factor removed via the emergency exit',
    );
    assert.equal(await zf.isActive(idV), true);
    assert.equal((await remove(idS)).status, 200, 'a foreign factor can no longer be removed');
    // Announced like every takeover (src/account/adminActions.ts); effective in the cleanup run.
    assert.equal(await zf.isActive(idS), true);
    assert.equal(await require('./helpers/admin').takeoverNow(_req, db, idS), 1);
    assert.equal(await zf.isActive(idS), false);
  } finally {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, LOCK, BRAKE, ADMINISTRATOR]]).catch(() => {});
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`%zf_%${process.pid}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
