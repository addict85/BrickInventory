/**
 * Passkeys (WebAuthn): registering, logging in without password and as second
 * factor — with a P-256 key generated in Node that signs the attestation
 * „none“ and every assertion itself. Checked via the real
 * routes against a real database.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in loeseChallengeEin() the DELETE … RETURNING replaced by a SELECT
 *      (challenge valid several times) → red: “a response only applies once …”
 *      (with the passkey without a counter the repetition went through)
 *   B  in anmeldungPruefen() additionally 'https://boese.test' allowed as origin
 *      → red: “a foreign origin is rejected”
 *   C  requireUserVerification set to false when logging in without password → red:
 *      “without password user verification is needed”
 *   D  in checkCredentials() the binding to the account left out (uid null)
 *      → red: “passkey as second factor …” (Bert's passkey opened Anna's account)
 *   E  stored counter ignored (counter: 0, UPDATE without counter condition)
 *      → red: “… and an old counter does not”
 *   F  (31.10.2026) in anmeldungPruefen() `...androidOrigins()` deleted from
 *      expectedOrigin → red: “the registered app logs in …”
 *   G  (31.10.2026) in /passkey/anmelden `mit_token` ignored (always false) →
 *      red: “the registered app logs in …” (no token)
 * Counter-checks (measured 01.11.2026):
 *   H  (26.11.2026) a password check back into /passkey/register/options → red:
 *      “with a second factor a new passkey needs no code either” (400 instead of 200)
 *   I  setPasswordBack() without loescheAlleDesKontos → red: “resetting via mail …”
 *   J  hintInBackground() removed in /reset-password → red: „kein Hinweis verschickt“
 *   K  passkeys_widerrufen ignored → red: “a password change revokes passkeys only on request”
 *   L  (11.11.2026) in speichereChallenge() the count condition deleted → red:
 *      “above the upper limit of open challenges …” (200 instead of 503)
 * Counter-checks (measured 15.11.2026, each on its own; login options now signed instead of stored):
 *   M  in signierteFrist() the comparison of the signature deleted → red: “an invented …”
 *   N  in signierteFrist() the purpose not checked → red: “an invented …” (second factor 200)
 *   O  in anmeldungPruefen() vermerkeVerbraucht() skipped → red: “a response only applies once …”
 *   P  in speichereChallenge() without `WHERE zweck = $3` → red: “login options store nothing …”
 *      (registering 503 with full login pots)
 *   Q  anmeldeOptionen() additionally with merkeChallenge() → red among others “login options store
 *      nothing …” (rows created) and every login (the note hits the stored row)
 *
 * Prerequisite: test DB (contents are touched!) via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });
environment({ APP_BASE_URL: 'https://lego.test' });

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const zf = _req('src/factors/secondFactor.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { isoCBOR } = require(
  path.join(ROOT, 'node_modules', '@simplewebauthn', 'server', 'script', 'helpers', 'index.js'),
);

const PASS = 'richtigesPasswort1';
const ORIGIN = 'https://lego.test',
  RP = 'lego.test';
const b64u = b => Buffer.from(b).toString('base64url');
const sha = b => crypto.createHash('sha256').update(b).digest();

/** An authenticator from a key pair: produces attestation and assertions. */
function authenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = crypto.randomBytes(16);
  let counter = 0;
  const cose = isoCBOR.encode(
    new Map(
      /** @type {[number, unknown][]} */ ([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x, 'base64url')],
        [-3, Buffer.from(jwk.y, 'base64url')],
      ]),
    ),
  );
  const num = n => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return {
    id: b64u(id),
    register(challenge, origin = ORIGIN) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const len = Buffer.alloc(2);
      len.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        sha(RP),
        Buffer.from([0x45]),
        num(0),
        Buffer.alloc(16),
        len,
        id,
        Buffer.from(cose),
      ]);
      const att = isoCBOR.encode(
        new Map(
          /** @type {[string, unknown][]} */ ([
            ['fmt', 'none'],
            ['attStmt', new Map()],
            ['authData', authData],
          ]),
        ),
      );
      return {
        id: b64u(id),
        rawId: b64u(id),
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON: b64u(client), attestationObject: b64u(att), transports: ['internal'] },
      };
    },
    /** @param challenge @param {object} [o] @param [o.uv] user verification set @param [o.counter] fixed counter value
     *  @param {string} [o.origin] origin of the login */
    signIn(challenge, o = {}) {
      const origin = o.origin ?? ORIGIN;
      const state = o.counter ?? ++counter;
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([sha(RP), Buffer.from([o.uv === false ? 0x01 : 0x05]), num(state)]);
      const sig = crypto.sign('sha256', Buffer.concat([authData, sha(client)]), privateKey);
      return {
        id: b64u(id),
        rawId: b64u(id),
        type: 'public-key',
        clientExtensionResults: {},
        response: { clientDataJSON: b64u(client), authenticatorData: b64u(authData), signature: b64u(sig) },
      };
    },
  };
}

test('Passkeys', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const hash = await bcrypt.hash(PASS, 4);
  const ids = {};
  for (const n of ['pk_anna', 'pk_bert']) {
    await db.run('DELETE FROM users WHERE username = $1', [n]);
    await db.run(
      'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
      [n, hash],
    );
    ids[n] = (await db.get('SELECT id FROM users WHERE username=$1', [n])).id;
  }

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
  app.use(
    '/api/v2',
    _req('routes/api/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v2/auth`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run("DELETE FROM users WHERE username IN ('pk_anna', 'pk_bert')");
    await db.pool.end();
  });

  const callFn = async (route, body, cookie) => {
    const r = await fetch(basis + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      cookie: r.headers.get('set-cookie')?.split(';')[0],
      body: await r.json().catch(() => null),
    };
  };
  const sess = async name => (await callFn('/login', { username: name, password: PASS, without_token: true })).cookie;
  const register = async (name, key) => {
    const c = await sess(name);
    const o = await callFn('/passkey/register/options', {}, c);
    assert.equal(o.status, 200, JSON.stringify(o.body));
    assert.equal(o.body.options.rp.id, RP);
    const r = await callFn(
      '/passkey/register',
      { response: key.register(o.body.options.challenge), name: 'Laptop' },
      c,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return c;
  };
  const options = async purpose => (await callFn('/passkey/login/options', { purpose })).body.options.challenge;

  const anna = authenticator(),
    bert = authenticator(),
    withoutCounter = authenticator();
  let annaCodes = [];

  await t.test('register and log in without password', async () => {
    const c = await register('pk_anna', anna);
    const list = await callFn('/passkeys', undefined, c);
    assert.equal(list.body.passkeys.length, 1);
    assert.equal(list.body.passkeys[0].name, 'Laptop');

    const a = await callFn('/passkey/login', { response: anna.signIn(await options()) });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.user.id, ids.pk_anna);
    const ich = await callFn('/me', undefined, a.cookie);
    assert.equal(ich.body.user.id, ids.pk_anna, 'The login creates a session');
  });

  await t.test('a response only applies once, and an old counter does not', async () => {
    const response = anna.signIn(await options());
    assert.equal((await callFn('/passkey/login', { response })).status, 200);
    assert.equal((await callFn('/passkey/login', { response })).status, 401, 'repeated response');
    // New challenge, but the counter value from just now: a cloned authenticator.
    const state = Number(
      (await db.get('SELECT sign_count FROM passkeys WHERE user_id = $1', [ids.pk_anna])).sign_count,
    );
    assert.ok(state > 0);
    const clone = anna.signIn(await options(), { counter: state });
    assert.equal((await callFn('/passkey/login', { response: clone })).status, 401, 'counter did not increase');

    // Many passkeys do not count at all (always 0): then the challenge alone protects.
    await register('pk_bert', withoutCounter);
    const null1 = withoutCounter.signIn(await options(), { counter: 0 });
    assert.equal((await callFn('/passkey/login', { response: null1 })).status, 200);
    assert.equal((await callFn('/passkey/login', { response: null1 })).status, 401, 'challenge valid only once');
  });

  await t.test('a foreign origin is rejected', async () => {
    const fremd = anna.signIn(await options(), { origin: 'https://boese.test' });
    assert.equal((await callFn('/passkey/login', { response: fremd })).status, 401);
    const c = await sess('pk_bert');
    const o = await callFn('/passkey/register/options', {}, c);
    const r = await callFn(
      '/passkey/register',
      { response: authenticator().register(o.body.options.challenge, 'https://boese.test') },
      c,
    );
    assert.equal(r.status, 400);
  });

  await t.test('without password user verification is needed', async () => {
    const withoutUv = anna.signIn(await options(), { uv: false });
    assert.equal((await callFn('/passkey/login', { response: withoutUv })).status, 401);
  });

  await t.test('passkey as second factor instead of the TOTP code, only for the own account', async () => {
    const secret = await zf.beginSetup(ids.pk_anna);
    annaCodes = await zf.confirmSetup(ids.pk_anna, zf.hotp(zf.fromBase32(secret), zf.timeStep()));
    await register('pk_bert', bert);

    const without = await callFn('/login', { username: 'pk_anna', password: PASS, without_token: true });
    assert.equal(without.status, 401);
    assert.equal(without.body.second_factor, true);
    assert.equal(without.body.passkey, true, 'The client learns that a passkey works');

    const fremd = await callFn('/login', {
      username: 'pk_anna',
      password: PASS,
      without_token: true,
      passkey: bert.signIn(await options('second_factor')),
    });
    assert.equal(fremd.status, 401, "Another account's passkey opens nothing");

    const ok = await callFn('/login', {
      username: 'pk_anna',
      password: PASS,
      without_token: true,
      passkey: anna.signIn(await options('second_factor'), { uv: false }),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  const APP_HASH = crypto.createHash('sha256').update('app-zertifikat').digest();
  const appOrigin = h => `android:apk-key-hash:${b64u(h)}`;

  await t.test('the registered app logs in and gets a token', async tt => {
    environment({ PASSKEY_ANDROID_CERTIFICATES: APP_HASH.toString('hex').match(/../g).join(':') });
    tt.after(() => {
      environment({ PASSKEY_ANDROID_CERTIFICATES: undefined });
    });
    const a = await callFn('/passkey/login', {
      response: anna.signIn(await options(), { origin: appOrigin(APP_HASH) }),
      with_token: true,
      scope: 'app',
      label: 'Pixel',
    });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.match(a.body.token, /^[0-9a-f]{64}$/);
    assert.equal(a.body.token_info.scope, 'app');
    const ich = await fetch(`${basis}/me`, { headers: { authorization: `Bearer ${a.body.token}` } });
    assert.equal((await ich.json()).user.id, ids.pk_anna, "The token belongs to the passkey's account");

    const without = await callFn('/passkey/login', { response: anna.signIn(await options()) });
    assert.equal(without.status, 200);
    assert.equal(without.body.token, undefined, 'The browser gets no token');

    const secondOne = await callFn('/login', {
      username: 'pk_anna',
      password: PASS,
      without_token: true,
      passkey: anna.signIn(await options('second_factor'), { origin: appOrigin(APP_HASH) }),
    });
    assert.equal(secondOne.status, 200, 'The app also counts as a second factor');
  });

  await t.test('an app with a different or no registered certificate is rejected', async tt => {
    const fremd = crypto.createHash('sha256').update('fremdes-zertifikat').digest();
    environment({ PASSKEY_ANDROID_CERTIFICATES: APP_HASH.toString('hex') });
    tt.after(() => {
      environment({ PASSKEY_ANDROID_CERTIFICATES: undefined });
    });
    const r = await callFn('/passkey/login', {
      response: anna.signIn(await options(), { origin: appOrigin(fremd) }),
      with_token: true,
    });
    assert.equal(r.status, 401);
    environment({ PASSKEY_ANDROID_CERTIFICATES: undefined });
    const without = await callFn('/passkey/login', {
      response: anna.signIn(await options(), { origin: appOrigin(APP_HASH) }),
      with_token: true,
    });
    assert.equal(without.status, 401, 'Without an entry the server accepts no app');
  });

  await t.test('deleting needs only the login', async () => {
    const c = await sess('pk_bert');
    const list = (await callFn('/passkeys', undefined, c)).body.passkeys;
    assert.equal(list.length, 2);
    const removeIt = (id, body) =>
      fetch(`${basis}/passkeys/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie: c },
        body: JSON.stringify(body),
      });
    for (const p of list) assert.equal((await (await removeIt(p.id, {})).json()).deleted, 1);
    assert.equal((await callFn('/passkey/login', { response: bert.signIn(await options()) })).status, 401);
  });

  const count = async uid => (await db.get('SELECT COUNT(*)::int n FROM passkeys WHERE user_id = $1', [uid])).n;

  await t.test('with a second factor a new passkey needs no code either', async () => {
    const c = (await callFn('/login', { username: 'pk_anna', password: PASS, without_token: true, code: annaCodes[0] }))
      .cookie;
    const withIt = await callFn('/passkey/register/options', {}, c);
    assert.equal(withIt.status, 200, JSON.stringify(withIt.body));
    const r = await callFn(
      '/passkey/register',
      { response: authenticator().register(withIt.body.options.challenge) },
      c,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await count(ids.pk_anna), 2);
  });

  await t.test('a password change revokes passkeys only on request', async () => {
    const c = await register('pk_bert', authenticator());
    const change = (cookie, alt, fresh, more = {}) =>
      callFn('/change-password', { current: alt, newPassword: fresh, ...more }, cookie);
    assert.equal((await change(c, PASS, 'zwischenPasswort-9')).status, 200);
    assert.equal(await count(ids.pk_bert), 1, 'without a request the passkeys stay');
    const c2 = (await callFn('/login', { username: 'pk_bert', password: 'zwischenPasswort-9', without_token: true }))
      .cookie;
    assert.equal((await change(c2, 'zwischenPasswort-9', PASS, { passkeys_revoked: true })).status, 200);
    assert.equal(await count(ids.pk_bert), 0, 'passkeys_widerrufen has no effect');
  });

  await t.test('resetting via mail revokes all passkeys and reports it', async tt => {
    assert.ok((await count(ids.pk_anna)) > 0);
    // A mail server that does not answer: the attempt then stands in the error log.
    await db.run(`INSERT INTO global_settings (key, value) VALUES ('smtp_host', '127.0.0.1'), ('smtp_port', '1'), ('smtp_user', 'x')
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    await db.run("UPDATE users SET email = 'pk_anna@example.org' WHERE id = $1", [ids.pk_anna]);
    tt.after(() => db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user')"));
    const raw = crypto.randomBytes(16).toString('hex');
    await db.run("UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2", [
      crypto.createHash('sha256').update(raw).digest('hex'),
      ids.pk_anna,
    ]);
    const lines = [],
      original = console.error;
    console.error = (...a) => {
      lines.push(a.join(' '));
    };
    try {
      const r = await callFn('/reset-password', { token: raw, password: 'ganzNeuesPasswort-7' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      for (let i = 0; i < 100 && !lines.some(z => z.includes('SMTP')); i++) await new Promise(f => setTimeout(f, 50));
    } finally {
      console.error = original;
    }
    assert.equal(await count(ids.pk_anna), 0, 'a planted passkey survives the reset');
    assert.equal((await callFn('/passkey/login', { response: anna.signIn(await options()) })).status, 401);
    assert.ok(
      lines.some(z => z.includes('SMTP') && z.includes('example.org')),
      `no hint sent: ${lines.join('\n')}`,
    );
  });

  await t.test('an invented, changed or repurposed challenge is rejected', async () => {
    // The resetting just revoked Anna's passkeys.
    const carl = authenticator();
    await register('pk_bert', carl);
    const original = await options();
    const b = Buffer.from(original, 'base64url');
    b[30] ^= 1;
    const wrong = [
      ['erfunden', b64u(crypto.randomBytes(55))],
      ['verändert', b64u(b)],
      ['zweiter Faktor', await options('second_factor')],
    ];
    const status = [];
    for (const [, c] of wrong) status.push((await callFn('/passkey/login', { response: carl.signIn(c) })).status);
    assert.deepEqual(status, [401, 401, 401], wrong.map(([n]) => n).join(', '));
    assert.equal(
      (await callFn('/passkey/login', { response: carl.signIn(original) })).status,
      200,
      'the real one counts',
    );
  });

  await t.test('login options store nothing, a full pot only locks its purpose', async tt => {
    const { MAX_OPEN_CHALLENGES: N } = _req('src/factors/passkeys.js');
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'passkey-optionen|%'");
    await db.run('DELETE FROM webauthn_challenges');
    tt.after(() => db.run("DELETE FROM webauthn_challenges WHERE challenge LIKE 'voll%'"));
    const fill = purpose =>
      db.run(
        `INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at)
        SELECT 'voll' || $2 || g, NULL, $2, NOW() + INTERVAL '5 minutes' FROM generate_series(1, $1::int) g`,
        [N, purpose],
      );
    const count = async () => (await db.get('SELECT count(*)::int AS n FROM webauthn_challenges')).n;
    await fill('login');
    await fill('second_factor');
    for (const purpose of ['login', 'second_factor'])
      assert.equal((await callFn('/passkey/login/options', { purpose })).status, 200, purpose);
    assert.equal(await count(), 2 * N, 'the login options created a row');
    const c = await sess('pk_bert');
    const reg = () => callFn('/passkey/register/options', { password: PASS }, c);
    assert.equal((await reg()).status, 200, 'full login buckets block registering');
    await fill('register');
    const r = await reg();
    assert.deepEqual([r.status, r.body?.code], [503, 'server_busy']);
    assert.equal(
      (await callFn('/passkey/login/options', {})).status,
      200,
      'a full registration bucket blocks logging in',
    );
    await db.run(
      `UPDATE webauthn_challenges SET expires_at = NOW() - INTERVAL '1 minute' WHERE challenge LIKE 'voll%'`,
    );
    assert.equal((await reg()).status, 200, 'the next call clears expired ones');
  });
});
