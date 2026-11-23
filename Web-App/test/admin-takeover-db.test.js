/**
 * An administrator resets password or second factor of another account, deactivates it,
 * revokes the role or deletes it (routes/auth/users.ts, src/account/adminActions.ts).
 * Password and factor only apply after 24 hours for every account, the rest if the target is
 * an administrator (or just was), in the cleanup run; a login of the target (password, passkey,
 * QR collection) or the link from its mail cancels it. Via the real routes and the runtime role.
 *
 * Counter-checks (measured 14.11.2026, each alone):
 *   A  (22.11.2026) factorByAdmin removes the factor immediately again for a non-administrator
 *      (adminOrJustBeen check back) → red: “a normal account: password and factor also only
 *      after the deadline …” (no effective_at, factor gone at once)
 *   B  (22.11.2026) passwordByAdmin sets the password immediately (setForeignPassword) → red:
 *      the same check, “an administrator account: announced …” and eight more (no effective_at)
 *   C  in adminOrJustBeen only is_admin → red (measured anew 16.11.): “deactivating,
 *      revoking the role and deleting …” (after revocation a password immediately instead of announced)
 *   D  in signedInResponses (routes/auth.ts) cancelTakeovers deleted → red:
 *      “a login of the target cancels the announcement” (the factor fell anyway)
 *   E  in takeDue the condition on the still active administrator deleted → red:
 *      “… whoever lost the role enforces nothing anymore” (the hash was replaced)
 *   F  in the cleanup run `endAccesses` deleted → red: “… after the period …”
 * Counter-checks (measured 16.11.2026, each alone):
 *   G  in aktivSetzen (adminActions.ts) the announcement deleted → red: “deactivating,
 *      revoking the role and deleting …” (deactivated immediately, no effective_at)
 *   H  in executeTeardown the branch `loeschen` routed to deactivate → red: the same check
 *      (the account stayed)
 *   I  redeemMailLink without abort (search only) → red: “the link from the mail …”
 *   J  in takeDue the check for a simultaneously due deactivation deleted → red: “… drops
 *      if the target was deactivated” (case a, the hash was replaced); the check for the
 *      log entry since the announcement deleted → red: the same check (case b)
 *   K  in routes/auth/qr.ts cancelTakeovers deleted → red: “a QR collection …”
 *   L  accountsList without `angekuendigt` → red: “the account list shows …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { until } = require('./helpers/time');
const db = S.testData();
const { hashPassword, passwordFits } = _req('src/account/passwordHash.js');
const zf = _req('src/factors/secondFactor.js');
const { decrypt } = _req('src/infra/secret.js');
/** A real second factor; the recovery codes come back. */
async function withFactor(uid) {
  await S.asAccount(uid, () => zf.beginSetup(uid));
  const z = await db.get('SELECT secret FROM second_factor WHERE user_id = $1', [uid]);
  const secret = zf.fromBase32(decrypt(z.secret, zf.secondFactorContext(uid)));
  return S.asAccount(uid, () => zf.confirmSetup(uid, zf.hotp(secret, zf.timeStep())));
}
const mails = [];
S.replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, type, o) => {
    mails.push({ an, type, ...o });
    return { success: true };
  },
});

test('admin takes over an account', { concurrency: 1, timeout: 180_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    PASS = 'Uebernahme-Pruefung-1',
    NEW = 'Neu-Gesetzt-Durch-Verwalter-1';
  const names = ['chef', 'nutzer', 'vw', 'vw2', 'vw3', 'vw4', 'vw5', 'vw6', 'vw7', 'vw8', 'vw9', 'nutzer2'].map(
    n => `ueb_${n}_${P}`,
  );
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
  const hash = await hashPassword(PASS);
  const account = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
         VALUES ($1, $1 || '@beispiel.de', $2, $3, true, true) RETURNING id`,
        [name, hash, admin],
      )
    ).id;
  const ids = [];
  for (const [i, n] of names.entries()) ids.push(await account(n, i !== 1 && i !== 11));
  const [chef, user, vw, vw2, vw3, vw4, vw5, vw6, vw7, vw8, vw9, user2] = ids;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [names]).catch(() => {});
    await db.run(`DELETE FROM user_sessions WHERE sid LIKE 'ueb-%'`).catch(() => {});
    await db.run(`DELETE FROM rate_limit_attempts`).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  // Every administrator action uses up a code; ten are not enough here, so more of the same set.
  const codes = await withFactor(chef);
  const { searchValue } = _req('src/infra/secret.js');
  for (let i = 0; i < 30; i++) {
    const c = `zusatz${String(i).padStart(4, '0')}abcdef`;
    await db.run('INSERT INTO second_factor_codes (user_id, code_hash) VALUES ($1, $2)', [
      chef,
      searchValue('zweiter-faktor-code', `${chef}:${c}`),
    ]);
    codes.push(c);
  }
  const { base } = testServer(_req, { session: { userId: chef, username: names[0], isAdmin: true }, t });
  const callFn = async (method, route, body, b = base) => {
    const r = await fetch(`${b}/api/v2/auth${route}`, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, code: body?.code ?? codes.shift() }),
    });
    return { status: r.status, body: await r.json() };
  };
  const accesses = async uid => {
    await db.run(`INSERT INTO api_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      `ueb-${uid}-${Date.now()}`,
      uid,
    ]);
    await db.run(`INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      `ueb-${uid}-${Date.now()}`,
      JSON.stringify({ userId: uid }),
    ]);
  };
  const state = async uid => ({
    tokens: (await db.all('SELECT 1 FROM api_tokens WHERE user_id = $1', [uid])).length,
    sessions: (await db.all(`SELECT 1 FROM user_sessions WHERE sess::jsonb->>'userId' = $1`, [String(uid)])).length,
    factor: (await db.all('SELECT 1 FROM second_factor WHERE user_id = $1', [uid])).length,
    newPassword: await passwordFits(
      NEW,
      (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash,
    ),
  });
  const accounts = async uid => db.get('SELECT is_admin, is_active FROM users WHERE id = $1', [uid]);
  const factor = uid => db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', true)`, [uid]);
  const due = async uid => {
    await db.run(`UPDATE admin_takeovers SET effective_at = NOW() - INTERVAL '1 minute' WHERE target_id = $1`, [uid]);
    return _req('src/account/adminActions.js').runDueTakeoversFrom();
  };
  const open = async uid =>
    (await db.all('SELECT type FROM admin_takeovers WHERE target_id = $1 ORDER BY type', [uid])).map(z => z.type);
  const inTime = r => {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const hours = (Date.parse(r.body.effective_at) - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24, `effective_at ${r.body.effective_at}`);
  };
  const abortLink = async uid => {
    const an = `${names[ids.indexOf(uid)]}@beispiel.de`;
    const m = () => [...mails].reverse().find(x => x.type === 'takeover_announced' && x.an === an);
    await until(() => m(), 1000);
    return m()?.cancelToken;
  };

  await t.test('a normal account: password and factor also only after the deadline, with mail and link', async () => {
    mails.length = 0;
    await factor(user);
    await accesses(user);
    const f = await callFn('DELETE', `/users/${user}/second-factor`, { admin_password: PASS });
    const p = await callFn('PUT', `/users/${user}/password`, { password: NEW, admin_password: PASS });
    for (const r of [p, f]) inTime(r);
    assert.deepEqual(await state(user), { tokens: 1, sessions: 1, factor: 1, newPassword: false });
    const link = await abortLink(user);
    assert.ok(link, 'the target gets a mail and a cancel link');
    const anAdmin = mails.filter(m => m.type === 'admin_takeover_announced');
    assert.ok(anAdmin.length >= 1 && anAdmin.every(m => !m.cancelToken), 'the admins learn about it, without a link');
    assert.equal(await due(user), 2);
    assert.deepEqual(await state(user), { tokens: 0, sessions: 0, factor: 0, newPassword: true });
    // The link of a normal account cancels like that of an administrator.
    mails.length = 0;
    inTime(await callFn('PUT', `/users/${user}/password`, { password: PASS, admin_password: PASS }));
    const r = await fetch(`${base}/api/v2/auth/cancel-takeover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: '' },
      body: JSON.stringify({ token: await abortLink(user) }),
    });
    assert.equal(r.status, 200, await r.text());
    assert.deepEqual(await open(user), []);
    // Deactivating a normal account takes nothing over: it stays immediate.
    const a = await callFn('PUT', `/users/${user2}/active`, { is_active: false, admin_password: PASS });
    assert.deepEqual([a.status, a.body.effective_at, (await accounts(user2)).is_active], [200, undefined, false]);
  });

  await t.test('an admin account: announced, effective only after the deadline, then the accesses end', async () => {
    await factor(vw);
    await accesses(vw);
    const p = await callFn('PUT', `/users/${vw}/password`, { password: NEW, admin_password: PASS });
    const f = await callFn('DELETE', `/users/${vw}/second-factor`, { admin_password: PASS });
    for (const r of [p, f]) inTime(r);
    assert.deepEqual(await state(vw), { tokens: 1, sessions: 1, factor: 1, newPassword: false });
    assert.equal(await _req('src/account/adminActions.js').runDueTakeoversFrom(), 0, 'before the deadline');
    assert.equal(await due(vw), 2);
    assert.deepEqual(await state(vw), { tokens: 0, sessions: 0, factor: 0, newPassword: true });
    assert.deepEqual(await open(vw), []);
  });

  await t.test('deactivating, revoking the role and deleting an admin: announced, then effective', async () => {
    mails.length = 0;
    inTime(await callFn('PUT', `/users/${vw4}/active`, { is_active: false, admin_password: PASS }));
    inTime(await callFn('PUT', `/users/${vw5}/admin`, { is_admin: false, admin_password: PASS }));
    inTime(await callFn('DELETE', `/users/${vw6}`, { admin_password: PASS }));
    assert.deepEqual(
      [await accounts(vw4), await accounts(vw5), await accounts(vw6)],
      [
        { is_admin: true, is_active: true },
        { is_admin: true, is_active: true },
        { is_admin: true, is_active: true },
      ],
      'nothing changes before the deadline',
    );
    assert.ok(await abortLink(vw4), 'the target gets a cancel link');
    const anAdmin = mails.filter(m => m.type === 'admin_takeover_announced');
    assert.ok(anAdmin.length >= 3 && anAdmin.every(m => !m.cancelToken), 'the other admins without a link');
    for (const uid of [vw4, vw5, vw6]) await due(uid);
    assert.deepEqual(
      [await accounts(vw4), await accounts(vw5), await accounts(vw6)],
      [{ is_admin: true, is_active: false }, { is_admin: false, is_active: true }, undefined],
    );
    // Whoever just lost the role still counts as administrator: otherwise one would first revoke it and then take over immediately.
    inTime(await callFn('PUT', `/users/${vw5}/password`, { password: NEW, admin_password: PASS }));
  });

  await t.test('first revoke the role, then take over: both announced', async () => {
    inTime(await callFn('PUT', `/users/${vw2}/admin`, { is_admin: false, admin_password: PASS }));
    inTime(await callFn('PUT', `/users/${vw2}/password`, { password: NEW, admin_password: PASS }));
    assert.deepEqual(await open(vw2), ['password', 'revoke_role']);
    assert.equal((await state(vw2)).newPassword, false);
  });

  await t.test('a login of the target cancels the announcement', async () => {
    const owned = await withFactor(vw3);
    inTime(await callFn('DELETE', `/users/${vw3}/second-factor`, { admin_password: PASS }));
    // A separate server: the login would otherwise write into the administrator's session.
    const login = testServer(_req, { session: {}, t }).base;
    const a = await fetch(`${login}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: names[4], password: PASS, code: owned[0], without_token: true }),
    });
    assert.equal(a.status, 200, await a.text());
    assert.deepEqual(await open(vw3), []);
    await due(vw3);
    assert.equal((await state(vw3)).factor, 1, 'the factor was dropped despite the sign-in');
  });

  await t.test('the link from the mail cancels without login, once', async () => {
    mails.length = 0;
    inTime(await callFn('PUT', `/users/${vw7}/active`, { is_active: false, admin_password: PASS }));
    inTime(await callFn('PUT', `/users/${vw7}/password`, { password: NEW, admin_password: PASS }));
    const link = await abortLink(vw7);
    const cancel = token =>
      fetch(`${base}/api/v2/auth/cancel-takeover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: '' },
        body: JSON.stringify({ token }),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    assert.equal((await cancel('falsch')).body.code, 'cancel_link_invalid');
    assert.deepEqual(await open(vw7), ['deactivate', 'password']);
    const r = await cancel(link);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await open(vw7), []);
    assert.equal((await cancel(link)).body.code, 'cancel_link_invalid', 'only once');
    await due(vw7);
    assert.deepEqual(await accounts(vw7), { is_admin: true, is_active: true });
  });

  await t.test('a due takeover is dropped if the target was deactivated', async () => {
    // a) deactivation and password become due at the same time
    inTime(await callFn('PUT', `/users/${vw8}/active`, { is_active: false, admin_password: PASS }));
    inTime(await callFn('PUT', `/users/${vw8}/password`, { password: NEW, admin_password: PASS }));
    await due(vw8);
    assert.deepEqual([(await accounts(vw8)).is_active, (await state(vw8)).newPassword], [false, false]);
    // b) deactivated another way since the announcement
    inTime(await callFn('PUT', `/users/${vw9}/password`, { password: NEW, admin_password: PASS }));
    await S.asAccount(chef, () => _req('src/account/adminActions.js').persistActive(chef, vw9, false), {
      admin: true,
    });
    await due(vw9);
    assert.equal((await state(vw9)).newPassword, false);
  });

  await t.test('a QR pickup of the target cancels the announcement', async () => {
    const owned = await withFactor(vw);
    await db.run('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [vw, hash]);
    inTime(await callFn('PUT', `/users/${vw}/password`, { password: NEW, admin_password: PASS }));
    const version = (await db.get('SELECT session_version AS v FROM users WHERE id = $1', [vw])).v;
    const target = testServer(_req, {
      session: { userId: vw, username: names[2], isAdmin: true, sitzungsVersion: version },
      t,
    }).base.replace('localhost', '127.0.0.1');
    const qr = await callFn('POST', '/qr-token', { password: PASS, code: owned[0] }, target);
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    const raw = (route, body) =>
      fetch(`${target}/api/v2/auth${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    const m = await raw('/qr-login', { token: qr.body.token, label: 'Pixel Probe' });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const b = await raw(`/qr-pairing/${qr.body.pairing}/confirm`, { code: m.body.code });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(await open(vw), ['password']);
    const a = await raw('/qr-login/collect', { pickup: m.body.pickup });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(await open(vw), []);
  });

  await t.test('the account list shows announced changes with their time', async () => {
    const r = await fetch(`${base}/api/v2/auth/users`).then(x => x.json());
    const z = r.users.find(u => u.id === vw2);
    assert.deepEqual(z.announced.map(a => a.type).sort(), ['password', 'revoke_role']);
    assert.ok(z.announced.every(a => Date.parse(a.effective_at) > Date.now()));
  });

  await t.test('… whoever lost the role no longer enforces anything', async () => {
    await db.run('UPDATE users SET is_admin = false WHERE id = $1', [chef]);
    try {
      assert.equal((await open(vw2)).length, 2);
      assert.equal(await due(vw2), 0);
      assert.deepEqual(await open(vw2), [], 'the announcement does not stay pending');
      assert.deepEqual([(await state(vw2)).newPassword, (await accounts(vw2)).is_admin], [false, true]);
    } finally {
      await db.run('UPDATE users SET is_admin = true WHERE id = $1', [chef]);
    }
  });
});
