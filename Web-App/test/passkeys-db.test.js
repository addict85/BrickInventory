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
 *   H  code requirement removed in /passkey/registrieren/optionen → red: “with a second
 *      factor a new passkey also requires the code”
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
  let zaehler = 0;
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
  const zahl = n => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return {
    id: b64u(id),
    registrieren(challenge, origin = ORIGIN) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin, crossOrigin: false }));
      const len = Buffer.alloc(2);
      len.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        sha(RP),
        Buffer.from([0x45]),
        zahl(0),
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
    /** @param challenge @param {object} [o] @param [o.uv] user verification set @param [o.zaehler] fixed counter value
     *  @param {string} [o.origin] origin of the login */
    anmelden(challenge, o = {}) {
      const origin = o.origin ?? ORIGIN;
      const stand = o.zaehler ?? ++zaehler;
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([sha(RP), Buffer.from([o.uv === false ? 0x01 : 0x05]), zahl(stand)]);
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
      store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(
    '/api/v1',
    _req('routes/api_v1/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use('/api/v1/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  app.use('/api/v1/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v1/auth`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run("DELETE FROM users WHERE username IN ('pk_anna', 'pk_bert')");
    await db.pool.end();
  });

  const ruf = async (weg, body, cookie) => {
    const r = await fetch(basis + weg, {
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
  const sitzung = async name => (await ruf('/login', { username: name, password: PASS, ohne_token: true })).cookie;
  const register = async (name, schluessel) => {
    const c = await sitzung(name);
    const o = await ruf('/passkey/registrieren/optionen', { password: PASS }, c);
    assert.equal(o.status, 200, JSON.stringify(o.body));
    assert.equal(o.body.optionen.rp.id, RP);
    const r = await ruf(
      '/passkey/registrieren',
      { antwort: schluessel.registrieren(o.body.optionen.challenge), name: 'Laptop' },
      c,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return c;
  };
  const optionen = async zweck => (await ruf('/passkey/anmelden/optionen', { zweck })).body.optionen.challenge;

  const anna = authenticator(),
    bert = authenticator(),
    withoutCounter = authenticator();
  let annaCodes = [];

  await t.test('register and log in without password', async () => {
    const c = await register('pk_anna', anna);
    const liste = await ruf('/passkeys', undefined, c);
    assert.equal(liste.body.passkeys.length, 1);
    assert.equal(liste.body.passkeys[0].name, 'Laptop');

    const a = await ruf('/passkey/anmelden', { antwort: anna.anmelden(await optionen()) });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.user.id, ids.pk_anna);
    const ich = await ruf('/me', undefined, a.cookie);
    assert.equal(ich.body.user.id, ids.pk_anna, 'Die Anmeldung legt eine Sitzung an');
  });

  await t.test('a response only applies once, and an old counter does not', async () => {
    const antwort = anna.anmelden(await optionen());
    assert.equal((await ruf('/passkey/anmelden', { antwort })).status, 200);
    assert.equal((await ruf('/passkey/anmelden', { antwort })).status, 401, 'Wiederholte Antwort');
    // New challenge, but the counter value from just now: a cloned authenticator.
    const stand = Number(
      (await db.get('SELECT sign_count FROM passkeys WHERE user_id = $1', [ids.pk_anna])).sign_count,
    );
    assert.ok(stand > 0);
    const clone = anna.anmelden(await optionen(), { zaehler: stand });
    assert.equal((await ruf('/passkey/anmelden', { antwort: clone })).status, 401, 'Zähler nicht gestiegen');

    // Many passkeys do not count at all (always 0): then the challenge alone protects.
    await register('pk_bert', withoutCounter);
    const null1 = withoutCounter.anmelden(await optionen(), { zaehler: 0 });
    assert.equal((await ruf('/passkey/anmelden', { antwort: null1 })).status, 200);
    assert.equal((await ruf('/passkey/anmelden', { antwort: null1 })).status, 401, 'Challenge nur einmal gültig');
  });

  await t.test('a foreign origin is rejected', async () => {
    const fremd = anna.anmelden(await optionen(), { origin: 'https://boese.test' });
    assert.equal((await ruf('/passkey/anmelden', { antwort: fremd })).status, 401);
    const c = await sitzung('pk_bert');
    const o = await ruf('/passkey/registrieren/optionen', { password: PASS }, c);
    const r = await ruf(
      '/passkey/registrieren',
      { antwort: authenticator().registrieren(o.body.optionen.challenge, 'https://boese.test') },
      c,
    );
    assert.equal(r.status, 400);
  });

  await t.test('without password user verification is needed', async () => {
    const withoutUv = anna.anmelden(await optionen(), { uv: false });
    assert.equal((await ruf('/passkey/anmelden', { antwort: withoutUv })).status, 401);
  });

  await t.test('passkey as second factor instead of the TOTP code, only for the own account', async () => {
    const geheim = await zf.beginSetup(ids.pk_anna);
    annaCodes = await zf.confirmSetup(ids.pk_anna, zf.hotp(zf.fromBase32(geheim), zf.timeStep()));
    await register('pk_bert', bert);

    const ohne = await ruf('/login', { username: 'pk_anna', password: PASS, ohne_token: true });
    assert.equal(ohne.status, 401);
    assert.equal(ohne.body.zweiter_faktor, true);
    assert.equal(ohne.body.passkey, true, 'Der Client erfährt, dass ein Passkey geht');

    const fremd = await ruf('/login', {
      username: 'pk_anna',
      password: PASS,
      ohne_token: true,
      passkey: bert.anmelden(await optionen('zweiter_faktor')),
    });
    assert.equal(fremd.status, 401, 'Der Passkey eines anderen Kontos öffnet nichts');

    const ok = await ruf('/login', {
      username: 'pk_anna',
      password: PASS,
      ohne_token: true,
      passkey: anna.anmelden(await optionen('zweiter_faktor'), { uv: false }),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });

  const APP_HASH = crypto.createHash('sha256').update('app-zertifikat').digest();
  const appOrigin = h => `android:apk-key-hash:${b64u(h)}`;

  await t.test('the registered app logs in and gets a token', async tt => {
    environment({ PASSKEY_ANDROID_ZERTIFIKATE: APP_HASH.toString('hex').match(/../g).join(':') });
    tt.after(() => {
      environment({ PASSKEY_ANDROID_ZERTIFIKATE: undefined });
    });
    const a = await ruf('/passkey/anmelden', {
      antwort: anna.anmelden(await optionen(), { origin: appOrigin(APP_HASH) }),
      mit_token: true,
      scope: 'app',
      label: 'Pixel',
    });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.match(a.body.token, /^[0-9a-f]{64}$/);
    assert.equal(a.body.token_info.scope, 'app');
    const ich = await fetch(`${basis}/me`, { headers: { authorization: `Bearer ${a.body.token}` } });
    assert.equal((await ich.json()).user.id, ids.pk_anna, 'Der Token gehört dem Konto des Passkeys');

    const ohne = await ruf('/passkey/anmelden', { antwort: anna.anmelden(await optionen()) });
    assert.equal(ohne.status, 200);
    assert.equal(ohne.body.token, undefined, 'Der Browser bekommt keinen Token');

    const zweiter = await ruf('/login', {
      username: 'pk_anna',
      password: PASS,
      ohne_token: true,
      passkey: anna.anmelden(await optionen('zweiter_faktor'), { origin: appOrigin(APP_HASH) }),
    });
    assert.equal(zweiter.status, 200, 'Auch als zweiter Faktor gilt die App');
  });

  await t.test('an app with a different or no registered certificate is rejected', async tt => {
    const fremd = crypto.createHash('sha256').update('fremdes-zertifikat').digest();
    environment({ PASSKEY_ANDROID_ZERTIFIKATE: APP_HASH.toString('hex') });
    tt.after(() => {
      environment({ PASSKEY_ANDROID_ZERTIFIKATE: undefined });
    });
    const r = await ruf('/passkey/anmelden', {
      antwort: anna.anmelden(await optionen(), { origin: appOrigin(fremd) }),
      mit_token: true,
    });
    assert.equal(r.status, 401);
    environment({ PASSKEY_ANDROID_ZERTIFIKATE: undefined });
    const ohne = await ruf('/passkey/anmelden', {
      antwort: anna.anmelden(await optionen(), { origin: appOrigin(APP_HASH) }),
      mit_token: true,
    });
    assert.equal(ohne.status, 401, 'Ohne Eintrag nimmt der Server keine App an');
  });

  await t.test('deleting requires the password', async () => {
    const c = await sitzung('pk_bert');
    const liste = (await ruf('/passkeys', undefined, c)).body.passkeys;
    assert.equal(liste.length, 2);
    const loesche = (id, body) =>
      fetch(`${basis}/passkeys/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie: c },
        body: JSON.stringify(body),
      });
    assert.equal((await loesche(liste[0].id, { password: 'falsch' })).status, 400);
    for (const p of liste) assert.equal((await (await loesche(p.id, { password: PASS })).json()).deleted, 1);
    assert.equal((await ruf('/passkey/anmelden', { antwort: bert.anmelden(await optionen()) })).status, 401);
  });

  const anzahl = async uid => (await db.get('SELECT COUNT(*)::int n FROM passkeys WHERE user_id = $1', [uid])).n;

  await t.test('with a second factor a new passkey also requires the code', async () => {
    const c = (await ruf('/login', { username: 'pk_anna', password: PASS, ohne_token: true, code: annaCodes[0] }))
      .cookie;
    const ohne = await ruf('/passkey/registrieren/optionen', { password: PASS }, c);
    assert.equal(ohne.status, 400, 'Passwort allein prägt einen Passkey am zweiten Faktor vorbei');
    assert.equal(ohne.body.code, 'zweiter_faktor_noetig');
    const mit = await ruf('/passkey/registrieren/optionen', { password: PASS, code: annaCodes[1] }, c);
    assert.equal(mit.status, 200, JSON.stringify(mit.body));
    const r = await ruf(
      '/passkey/registrieren',
      { antwort: authenticator().registrieren(mit.body.optionen.challenge) },
      c,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await anzahl(ids.pk_anna), 2);
  });

  await t.test('a password change revokes passkeys only on request', async () => {
    const c = await register('pk_bert', authenticator());
    const wechsel = (cookie, alt, neu, mehr = {}) =>
      ruf('/change-password', { current: alt, newPassword: neu, ...mehr }, cookie);
    assert.equal((await wechsel(c, PASS, 'zwischenPasswort-9')).status, 200);
    assert.equal(await anzahl(ids.pk_bert), 1, 'ohne Wunsch bleiben die Passkeys');
    const c2 = (await ruf('/login', { username: 'pk_bert', password: 'zwischenPasswort-9', ohne_token: true })).cookie;
    assert.equal((await wechsel(c2, 'zwischenPasswort-9', PASS, { passkeys_widerrufen: true })).status, 200);
    assert.equal(await anzahl(ids.pk_bert), 0, 'passkeys_widerrufen wirkt nicht');
  });

  await t.test('resetting via mail revokes all passkeys and reports it', async tt => {
    assert.ok((await anzahl(ids.pk_anna)) > 0);
    // A mail server that does not answer: the attempt then stands in the error log.
    await db.run(`INSERT INTO global_settings (key, value) VALUES ('smtp_host', '127.0.0.1'), ('smtp_port', '1'), ('smtp_user', 'x')
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    await db.run("UPDATE users SET email = 'pk_anna@example.org' WHERE id = $1", [ids.pk_anna]);
    tt.after(() => db.run("DELETE FROM global_settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user')"));
    const roh = crypto.randomBytes(16).toString('hex');
    await db.run("UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2", [
      crypto.createHash('sha256').update(roh).digest('hex'),
      ids.pk_anna,
    ]);
    const zeilen = [],
      echt = console.error;
    console.error = (...a) => {
      zeilen.push(a.join(' '));
    };
    try {
      const r = await ruf('/reset-password', { token: roh, password: 'ganzNeuesPasswort-7' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      for (let i = 0; i < 100 && !zeilen.some(z => z.includes('SMTP')); i++) await new Promise(f => setTimeout(f, 50));
    } finally {
      console.error = echt;
    }
    assert.equal(await anzahl(ids.pk_anna), 0, 'ein untergeschobener Passkey überlebt das Zurücksetzen');
    assert.equal((await ruf('/passkey/anmelden', { antwort: anna.anmelden(await optionen()) })).status, 401);
    assert.ok(
      zeilen.some(z => z.includes('SMTP') && z.includes('example.org')),
      `kein Hinweis verschickt: ${zeilen.join('\n')}`,
    );
  });

  await t.test('an invented, changed or repurposed challenge is rejected', async () => {
    // The resetting just revoked Anna's passkeys.
    const carl = authenticator();
    await register('pk_bert', carl);
    const echt = await optionen();
    const b = Buffer.from(echt, 'base64url');
    b[30] ^= 1;
    const falsch = [
      ['erfunden', b64u(crypto.randomBytes(55))],
      ['verändert', b64u(b)],
      ['zweiter Faktor', await optionen('zweiter_faktor')],
    ];
    const status = [];
    for (const [, c] of falsch) status.push((await ruf('/passkey/anmelden', { antwort: carl.anmelden(c) })).status);
    assert.deepEqual(status, [401, 401, 401], falsch.map(([n]) => n).join(', '));
    assert.equal((await ruf('/passkey/anmelden', { antwort: carl.anmelden(echt) })).status, 200, 'die echte gilt');
  });

  await t.test('login options store nothing, a full pot only locks its purpose', async tt => {
    const { MAX_OPEN_CHALLENGES: N } = _req('src/factors/passkeys.js');
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'passkey-optionen|%'");
    await db.run('DELETE FROM webauthn_challenges');
    tt.after(() => db.run("DELETE FROM webauthn_challenges WHERE challenge LIKE 'voll%'"));
    const fill = zweck =>
      db.run(
        `INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at)
        SELECT 'voll' || $2 || g, NULL, $2, NOW() + INTERVAL '5 minutes' FROM generate_series(1, $1::int) g`,
        [N, zweck],
      );
    const anzahl = async () => (await db.get('SELECT count(*)::int AS n FROM webauthn_challenges')).n;
    await fill('anmelden');
    await fill('zweiter_faktor');
    for (const zweck of ['anmelden', 'zweiter_faktor'])
      assert.equal((await ruf('/passkey/anmelden/optionen', { zweck })).status, 200, zweck);
    assert.equal(await anzahl(), 2 * N, 'die Anmeldeoptionen haben eine Zeile angelegt');
    const c = await sitzung('pk_bert');
    const reg = () => ruf('/passkey/registrieren/optionen', { password: PASS }, c);
    assert.equal((await reg()).status, 200, 'volle Anmeldetöpfe sperren das Registrieren');
    await fill('registrieren');
    const r = await reg();
    assert.deepEqual([r.status, r.body?.code], [503, 'server_ausgelastet']);
    assert.equal(
      (await ruf('/passkey/anmelden/optionen', {})).status,
      200,
      'ein voller Registriertopf sperrt das Anmelden',
    );
    await db.run(
      `UPDATE webauthn_challenges SET expires_at = NOW() - INTERVAL '1 minute' WHERE challenge LIKE 'voll%'`,
    );
    assert.equal((await reg()).status, 200, 'abgelaufene räumt der nächste Aufruf ab');
  });
});
