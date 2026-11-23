/**
 * The step-up protection of the app on the real server (dist/server.js): an app token
 * only gets to voucher PIN and administration with a signature of the
 * device key over a one-time challenge. The browser session stays
 * with the password.
 *
 * Counter-checks (measured 09.11.2026):
 *   A  in server.ts `app.use('/api/v2', stepProtectionAtInbox)` deleted →
 *      red: “without a device key …” (plain text 200 instead of 403)
 *   B  in requireApiAdmin again `next()` instead of requireRelease() → red:
 *      “administrator routes …” (/admin/cache-ttl 200 without approval)
 *   C  in resolveOne() the signature not checked (`passt = true`) → red:
 *      “a foreign signature …”
 *   D  in nachricht() the action left out → red: “a challenge is only good
 *      for its action”
 *   E  in createKey() the deadline multiplied by a thousand → red: “an old access …”
 *      (with a nonce from back then; without it createNonce() already holds)
 *   F  in depositKey() `takeNonce` skipped → red: “a chain with a foreign
 *      or used challenge …”
 *   G  in keyThe() `(attested OR NOW() < $3)` deleted → red: “a key
 *      without attestation applies until the cutoff date …”
 *   H  in qrNonceThe() `from_qr` deleted and newNonce() always new → red: “an access
 *      from QR pairing …”
 *   I  in routes/api/settings.ts POST /settings without freigegeben() → red:
 *      “every administrator path …” (POST /settings without approval 200); the same per
 *      path for smtp-test, einrichtung and quelle-testen with `requireToken`
 *      instead of `requireAdmin`, for import and instructions without freigegeben()
 *   J  in /settings/raw `isAdmin(req)` instead of asAdmin() → red:
 *      „ohne Freigabe zeigt /settings/raw nur Kontowerte“
 *   K  (14.11.2026) in depositKey() `if (!widerrufen) return …` deleted and
 *      `widerrufen ?? new Set()` passed → red: “without a fresh revocation list …”;
 *      `widerrufen: new Set()` (list never checked) → red in the same test
 *   L  (15.11.2026) three lines at once: in startup/app.ts the refusal for `/` at the end
 *      deleted, stepProtectionAtInbox again with the regexes `^…$` on req.path and
 *      in contractRouter the check of res.locals.schritt deleted → red: „auch anders
 *      geschrieben …“ (klartext/, DELETE vouchers/n/ and zweiter-faktor/einrichten/ 200). Each line
 *      alone catches the other two (contract-spelling-db, contract-endpoint).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { X509Certificate } = require('node:crypto');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const auth = _req('src/account/deviceToken.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { bis } = require('./helpers/time');
const { adminWithFactor } = require('./helpers/admin');
const { deviceKeys, signIt, releaseDevice, deposit } = require('./helpers/device');
const attestation = require('./helpers/attestation');
const repo = require('./helpers/sources').testArea('devices').deviceKeys;
const { pairQr } = require('./helpers/qr');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

test('step-up protection on the server', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `schritt_${process.pid}`,
    CHEF = `schrittchef_${process.pid}`,
    PASS = 'Schritt-Schutz-7x';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, CHEF]]);
  const anlegen = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified, is_admin)
    VALUES ($1, $2, $3, true, true, $4) RETURNING id`,
        [name, `${name}@example.org`, bcrypt.hashSync(PASS, 4), admin],
      )
    ).id;
  const uid = await anlegen(NAME, false),
    chefId = await anlegen(CHEF, true);
  const codes = await adminWithFactor(_req, chefId);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, chefId]]);
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'schrittschutz-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLE: 'web',
      APP_BASE_URL: `http://127.0.0.1:${port}`,
      ...attestation.UMGEBUNG,
    },
  });
  let log = '';
  srv.stdout.on('data', d => {
    log += d;
  });
  srv.stderr.on('data', d => {
    log += d;
  });
  t.after(async () => {
    srv.kill('SIGTERM');
    await bis(() => srv.exitCode !== null || srv.signalCode !== null, 4000);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  await bis(async () => (await fetch(`${basis}/api/v2/health/live`).catch(() => null)) !== null, 60_000);

  const callFn = async (weg, o = {}) => {
    const r = await fetch(basis + '/api/v2' + weg, {
      method: o.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.cookie ? { cookie: o.cookie, origin: basis } : {}),
      },
      ...(o.body ? { body: JSON.stringify(o.body) } : {}),
    });
    return { status: r.status, kopf: r.headers, body: await r.json().catch(() => null) };
  };
  const anmelden = async (name, extra = {}) => {
    const a = await callFn('/auth/login', {
      method: 'POST',
      body: { username: name, password: PASS, never_expires: true, ...extra },
    });
    assert.equal(a.status, 200, `${JSON.stringify(a.body)}\n${log}`);
    return a;
  };
  const token = (await anmelden(NAME)).body.token;
  const neu = await callFn('/vouchers', {
    method: 'POST',
    token,
    body: { number: '6006491234567890', pin: '4321', amount: 25, currency: 'CHF' },
  });
  assert.equal(neu.status, 200, JSON.stringify(neu.body));
  const gid = neu.body.voucher?.id ?? (await db.get('SELECT id FROM vouchers WHERE user_id = $1', [uid])).id;
  const klartext = o => callFn(`/vouchers/${gid}/plaintext`, { method: 'POST', body: { password: PASS }, ...o });
  let device;

  await t.test('without a device key an app token does not get to the PIN', async () => {
    const r = await klartext({ token });
    assert.deepEqual([r.status, r.body.code], [403, 'device_key_missing']);
    const c = await callFn('/device/step/challenge', { method: 'POST', token, body: { action: 'voucher' } });
    assert.deepEqual([c.status, c.body.code], [403, 'device_key_missing']);
  });

  await t.test(
    'even written differently an app token without approval does not get to PIN, deletion or codes',
    async () => {
      const open = [];
      for (const [method, weg] of [
        ['POST', `/vouchers/${gid}/plaintext`],
        ['POST', `/vouchers/${gid}/pdf-grant`],
        ['POST', '/vouchers/export/pdf-grant'],
        ['DELETE', `/vouchers/${gid}`],
        ['POST', '/auth/second-factor/codes'],
        ['POST', '/auth/second-factor/setup'],
      ]) {
        const genau = await callFn(weg, { method, token, body: { password: PASS, code: '123456' } });
        assert.deepEqual([genau.status, genau.body.code], [403, 'device_key_missing'], `${method} ${weg}`);
        const gross = weg.replace(/[a-z-]+$/, x => x.toUpperCase());
        for (const anders of [`${weg}/`, `${weg}//`, `${weg}%2F`, gross]) {
          const r = await callFn(anders, { method, token, body: { password: PASS, code: '123456' } });
          if (r.status < 400 || ![403, 404, 400].includes(r.status)) open.push(`${method} ${anders} → ${r.status}`);
        }
      }
      assert.deepEqual(open, []);
      assert.ok(await db.get('SELECT 1 FROM vouchers WHERE id = $1', [gid]), 'the voucher is still there');
    },
  );

  await t.test('without a fresh revocation list or with a revoked chain the server accepts no key', async () => {
    const versuch = async reason => {
      const h = await deposit(callFn, (await anmelden(NAME)).body.token);
      assert.deepEqual([h.response.status, h.response.body.code], [400, 'device_key_attestation'], reason);
      await bis(() => log.includes(`abgewiesen: ${reason}`), 5000);
      assert.match(log, new RegExp(`abgewiesen: ${reason}`));
      log = '';
    };
    await db.run("DELETE FROM run_state WHERE key = 'attestation_widerruf'");
    await versuch('widerrufsliste_fehlt');
    await attestation.storeRevocationList(db, [], new Date(Date.now() - 8 * 86_400_000));
    await versuch('widerrufsliste_fehlt');
    const wurzel = new X509Certificate(attestation.WURZEL.der);
    await attestation.storeRevocationList(db, ['1', wurzel.serialNumber.toLowerCase().replace(/^0+/, '')]);
    await versuch('widerrufen');
    await attestation.storeRevocationList(db, ['1']);
  });

  await t.test('the key applies once per access; another one is not pushed in later', async () => {
    const h = await deposit(callFn, token);
    assert.equal(h.response.status, 200, JSON.stringify(h.response.body));
    device = h.schluessel;
    const anderer = await deposit(callFn, token);
    assert.deepEqual([anderer.response.status, anderer.response.body.code], [409, 'device_key_exists']);
    const withoutChain = await callFn('/device/key', {
      method: 'POST',
      token,
      body: { public_key: device.public_key },
    });
    assert.deepEqual(
      [withoutChain.status, withoutChain.body.code],
      [400, 'device_key_attestation'],
      'A key without attestation (older app) is no longer accepted',
    );
  });

  await t.test('a chain with a foreign or used challenge, from software or a foreign root is rejected', async () => {
    const neu = (await anmelden(NAME)).body.token;
    const sendIt = chain => callFn('/device/key', { method: 'POST', token: neu, body: { chain } });
    const foreignChallenge = attestation.chain({ challenge: Buffer.alloc(32, 1) });
    assert.deepEqual([(await sendIt(foreignChallenge.chain)).body.code], ['device_key_attestation']);
    for (const o of [{ confidence: 0 }, { wurzel: attestation.newRoot('Fremd') }, { paket: 'com.boese.app' }]) {
      const n = (await callFn('/device/key/nonce', { method: 'POST', token: neu, body: {} })).body.nonce;
      const r = await sendIt(attestation.chain({ challenge: Buffer.from(n, 'base64url'), ...o }).chain);
      assert.deepEqual([r.status, r.body.code], [400, 'device_key_attestation'], JSON.stringify(o));
    }
    const ok = await deposit(callFn, neu);
    assert.equal(ok.response.status, 200, JSON.stringify(ok.response.body));
    const zweimal = await callFn('/device/key', {
      method: 'POST',
      token: (await anmelden(NAME)).body.token,
      body: { chain: attestation.chain({ challenge: Buffer.from(ok.nonce, 'base64url') }).chain },
    });
    assert.equal(zweimal.body.code, 'device_key_attestation', 'The nonce is valid once and only for its family');
  });

  await t.test('a key without attestation applies until the cutoff date and gives way to an attested one', async () => {
    const alt = (await anmelden(NAME)).body.token;
    const z = await db.get(
      `SELECT user_id AS uid, date_trunc('milliseconds', created_at) AS since FROM api_tokens
      WHERE token = $1`,
      [auth.tokenDigest(alt)],
    );
    const f = { uid: z.uid, since: z.since.toISOString() };
    await db.run('INSERT INTO device_keys (user_id, token_family, public_key) VALUES ($1, $2, $3)', [
      f.uid,
      f.since,
      deviceKeys().public_key,
    ]);
    assert.equal(
      (await klartext({ token: alt })).body.code,
      'step_approval_required',
      'before the cut-off date it is valid',
    );
    assert.equal(await repo.keyThe(f, new Date(Date.now() - 1000)), null, 'after the cut-off date no longer');
    const h = await deposit(callFn, alt);
    assert.equal(h.response.status, 200, JSON.stringify(h.response.body));
    assert.deepEqual(await repo.entryThe(f), { public_key: h.schluessel.public_key, attested: true });
    assert.equal(await repo.keyThe(f, new Date(0)), h.schluessel.public_key);
  });

  await t.test('an access from QR pairing only stores with the nonce of its collection', async () => {
    const sitzung = (await anmelden(NAME, { without_token: true })).kopf.get('set-cookie').split(';')[0];
    const qr = await callFn('/auth/qr-token', { method: 'POST', cookie: sitzung, body: { password: PASS } });
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    const post = (p, body, kopf) => callFn('/auth' + p, { method: 'POST', body, cookie: kopf.cookie });
    const a = await pairQr(post, qr.body, { cookie: sitzung });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.match(a.body.key_nonce, /^[\w-]{43}$/);
    for (let i = 0; i < 2; i++) {
      const n = await callFn('/device/key/nonce', { method: 'POST', token: a.body.token, body: {} });
      assert.equal(n.body.nonce, a.body.key_nonce, 'no second nonce next to the one from the pickup');
    }
    const h = await deposit(callFn, a.body.token);
    assert.equal(h.response.status, 200, JSON.stringify(h.response.body));
  });

  await t.test('with a key but without approval: still closed', async () => {
    const r = await klartext({ token });
    assert.deepEqual([r.status, r.body.code], [403, 'step_approval_required']);
  });

  await t.test('a foreign signature opens nothing, and the challenge is used up afterwards', async () => {
    const c = await callFn('/device/step/challenge', { method: 'POST', token, body: { action: 'voucher' } });
    assert.equal(c.status, 200);
    const fremd = await callFn('/device/step/approval', {
      method: 'POST',
      token,
      body: { challenge: c.body.challenge, signature: signIt(deviceKeys().privateKey, c.body.message) },
    });
    assert.deepEqual([fremd.status, fremd.body.code], [400, 'step_signature_invalid']);
    const spaeter = await callFn('/device/step/approval', {
      method: 'POST',
      token,
      body: { challenge: c.body.challenge, signature: signIt(device.privateKey, c.body.message) },
    });
    assert.equal(spaeter.status, 400, 'A challenge is valid exactly once');
    assert.equal((await klartext({ token })).status, 403);
  });

  await t.test('a challenge is only good for its action', async () => {
    const c = await callFn('/device/step/challenge', { method: 'POST', token, body: { action: 'admin' } });
    const reinterpreted = c.body.message.replace('\nadmin\n', '\nvoucher\n');
    assert.notEqual(reinterpreted, c.body.message);
    const r = await callFn('/device/step/approval', {
      method: 'POST',
      token,
      body: { challenge: c.body.challenge, signature: signIt(device.privateKey, reinterpreted) },
    });
    assert.equal(r.status, 400);
    // Correctly signed it opens the administration, not the vouchers.
    await releaseDevice(callFn, token, 'admin', device);
    assert.equal((await klartext({ token })).status, 403);
  });

  await t.test('after approval the PIN; expired closed again; another access has its own', async () => {
    await releaseDevice(callFn, token, 'voucher', device);
    const r = await klartext({ token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.pin, '4321');
    const zweiter = (await anmelden(NAME)).body.token;
    assert.equal(
      (await klartext({ token: zweiter })).body.code,
      'device_key_missing',
      'The approval applies to the token family, not the account',
    );
    await db.run(`UPDATE step_up_approvals SET until_at = NOW() - INTERVAL '1 second' WHERE user_id = $1`, [uid]);
    assert.equal((await klartext({ token })).body.code, 'step_approval_required');
  });

  await t.test('an old access can no longer store a key', async () => {
    const alt = (await anmelden(NAME)).body.token;
    await db.run(`UPDATE api_tokens SET created_at = NOW() - INTERVAL '1 hour' WHERE token = $1`, [
      auth.tokenDigest(alt),
    ]);
    const n = await callFn('/device/key/nonce', { method: 'POST', token: alt, body: {} });
    assert.deepEqual([n.status, n.body.code], [403, 'device_key_deadline']);
    // Even a nonce from back then does not help: it expires with the deadline of the family.
    const altNonce = Buffer.alloc(32, 9);
    await db.run(
      `INSERT INTO device_nonces (nonce, user_id, token_family, expires_at) SELECT $2, user_id,
       date_trunc('milliseconds', created_at), NOW() + INTERVAL '1 hour' FROM api_tokens WHERE token = $1`,
      [auth.tokenDigest(alt), altNonce.toString('base64url')],
    );
    const r = await callFn('/device/key', {
      method: 'POST',
      token: alt,
      body: { chain: attestation.chain({ challenge: altNonce }).chain },
    });
    assert.deepEqual([r.status, r.body.code], [403, 'device_key_deadline']);
  });

  await t.test('the browser session stays with the password', async () => {
    const a = await anmelden(NAME, { without_token: true });
    const keks = a.kopf.get('set-cookie').split(';')[0];
    const r = await klartext({ cookie: keks });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const c = await callFn('/device/step/challenge', { method: 'POST', cookie: keks, body: { action: 'voucher' } });
    assert.deepEqual([c.status, c.body.code], [403, 'app_token_only']);
  });

  await t.test('administrator routes of an app token only after the approval “verwaltung”', async () => {
    const voll = (await anmelden(CHEF, { scope: 'voll', code: codes.shift() })).body.token;
    const vorher = await callFn('/admin/cache-ttl', { token: voll });
    assert.deepEqual([vorher.status, vorher.body.code], [403, 'device_key_missing']);
    const h = await deposit(callFn, voll);
    assert.equal(h.response.status, 200, JSON.stringify(h.response.body));
    const s = h.schluessel;
    assert.equal((await callFn('/auth/users', { token: voll })).body.code, 'step_approval_required');
    await releaseDevice(callFn, voll, 'voucher', s);
    assert.equal(
      (await callFn('/admin/cache-ttl', { token: voll })).status,
      403,
      'Approving the vouchers opens no administration',
    );
    await releaseDevice(callFn, voll, 'admin', s);
    assert.equal((await callFn('/admin/cache-ttl', { token: voll })).status, 200);
    assert.equal((await callFn('/auth/users', { token: voll })).status, 200);
  });

  await t.test('every administrator path in settings and instructions requires the approval “verwaltung”', async () => {
    const voll = (await anmelden(CHEF, { scope: 'voll', code: codes.shift() })).body.token;
    await db.run(`INSERT INTO global_settings (key, value) VALUES ('smtp_host', 'mail.schritt.example')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    await db.run(`DELETE FROM global_settings WHERE key IN ('einrichtung_erledigt', 'default_price_condition')`);
    const restoreIt = async () => {
      const form = new FormData();
      const datei = JSON.stringify({ version: '3.0', global: { default_price_condition: 'U' }, user_settings: {} });
      form.append('file', new Blob([datei], { type: 'application/json' }), 'k.json');
      const r = await fetch(`${basis}/api/v2/settings/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${voll}` },
        body: form,
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const pathList = {
      'POST /settings': () =>
        callFn('/settings', { method: 'POST', token: voll, body: { default_price_condition: 'N' } }),
      'POST /settings/import': restoreIt,
      'POST /settings/smtp-test': () => callFn('/settings/smtp-test', { method: 'POST', token: voll, body: {} }),
      'GET /settings/setup': () => callFn('/settings/setup', { token: voll }),
      'POST /settings/setup/complete': () =>
        callFn('/settings/setup/complete', { method: 'POST', token: voll, body: {} }),
      'POST /settings/test-source': () =>
        callFn('/settings/test-source', { method: 'POST', token: voll, body: { source: 'keine' } }),
      'POST /sets/:setNumber/instructions': () =>
        callFn('/sets/10001-1/instructions', { method: 'POST', token: voll, body: {} }),
    };
    // Since the attestation the app stores the key with a chain (helpers/device.js).
    const h = await deposit(callFn, voll);
    assert.equal(h.response.status, 200, JSON.stringify(h.response.body));
    const s = h.schluessel;
    for (const [weg, callIt] of Object.entries(pathList)) {
      const r = await callIt();
      assert.deepEqual([r.status, r.body?.code], [403, 'step_approval_required'], `${weg} without approval`);
    }
    assert.equal(
      (await db.get(`SELECT value FROM global_settings WHERE key = 'default_price_condition'`))?.value,
      undefined,
      'without approval nothing is written',
    );
    const ohne = await callFn('/settings/raw', { token: voll });
    assert.equal(ohne.status, 200);
    assert.equal(ohne.body.settings.smtp_host, undefined, 'without approval /settings/raw only shows account values');
    const eigene = await callFn('/settings', { method: 'POST', token: voll, body: { language: 'de' } });
    assert.equal(eigene.status, 200, 'the own values need no approval');

    await releaseDevice(callFn, voll, 'admin', s);
    const erwartet = {
      'POST /settings': [200, undefined],
      'POST /settings/import': [200, undefined],
      'POST /settings/smtp-test': [400, 'smtp_not_configured'],
      'GET /settings/setup': [200, undefined],
      'POST /settings/setup/complete': [200, undefined],
      'POST /settings/test-source': [400, 'source_unknown'],
      'POST /sets/:setNumber/instructions': [202, undefined],
    };
    for (const [weg, callIt] of Object.entries(pathList)) {
      const r = await callIt();
      assert.deepEqual([r.status, r.body?.code], erwartet[weg], `${weg} with approval: ${JSON.stringify(r.body)}`);
    }
    assert.equal((await db.get(`SELECT value FROM global_settings WHERE key = 'einrichtung_erledigt'`))?.value, '1');
    assert.equal((await callFn('/settings/raw', { token: voll })).body.settings.smtp_host, 'mail.schritt.example');
  });
});
