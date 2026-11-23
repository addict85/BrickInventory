/**
 * New accesses and removed protection go out by mail: a new
 * app token and a QR access to the owner, a new administrator and a
 * removed second factor to all administrators (the removed factor also to
 * the affected account).
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  hintInBackground() removed in /token-create → red: “new token"
 *   B  hintInBackground() removed in /qr-token → red: “new QR access"
 *   C  adminHintInBackground() removed in PUT /users/:id/admin → red:
 *      “appointed administrator"
 *   D  in activeAdmin() `is_admin AND` removed → red: “new
 *      administrator account" (the mail also went to the ordinary account)
 *   E  hintInBackground() removed in PUT /users/:id/password → red:
 *      “foreign password by an administrator”
 * Counter-check (measured 04.11.2026):
 *   F  hintInBackground() removed in signedInResponses() (routes/auth.ts) →
 *      red: “token from login (new device)”
 *   G  hintInBackground() removed in /zweiter-faktor/bestaetigen or /abschalten
 *      → red: “own second factor set up and switched off”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.APP_BASE_URL = 'https://lego.test';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerServer } = require('./helpers/server');

const sent = [];
require('./helpers/sources').replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, type, o) => {
    sent.push({ an, type, ...o });
    return { success: true };
  },
});

const db = S.testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Hinweis-Passwort-1';

test('mails on new accesses', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    NAMES = [`zh_chef_${P}`, `zh_zwei_${P}`, `zh_nutzer_${P}`, `zh_neu_${P}`];
  const account = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [name, `${name}@example.org`, await bcrypt.hash(PASS, 4), admin],
      )
    ).id;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMES]);
  const chef = await account(NAMES[0], true),
    two = await account(NAMES[1], true),
    user = await account(NAMES[2], false);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMES]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const base = routerServer(_req, {
    session: { userId: chef, username: NAMES[0], isAdmin: true },
    routes: { '/api/v2/auth': 'routes/auth.js' },
    t,
  }).base;
  const callFn = async (method, route, body) => {
    const r = await fetch(`${base}/api/v2/auth${route}`, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    assert.equal(r.status, 200, `${route}: ${text}`);
    return JSON.parse(text);
  };
  /** The mails go out on the side; wait briefly until they arrive. */
  const mails = async (type, count) => {
    for (let i = 0; i < 60 && sent.filter(m => m.type === type).length < count; i++)
      await new Promise(r => setTimeout(r, 25));
    return sent
      .filter(m => m.type === type && NAMES.some(n => m.an === `${n}@example.org`))
      .map(m => ({ an: m.an.split('@')[0], konto: m.account, via: m.actor, name: m.passkey }))
      .sort((a, b) => a.an.localeCompare(b.an));
  };

  await t.test('new token', async () => {
    await callFn('POST', '/token-create', { password: PASS, label: 'Tablet' });
    assert.deepEqual(await mails('token_added', 1), [
      { an: NAMES[0], konto: undefined, via: undefined, name: 'Tablet' },
    ]);
  });

  await t.test('new QR access', async () => {
    await callFn('POST', '/qr-token', { password: PASS });
    assert.deepEqual(
      (await mails('qr_access_added', 1)).map(m => m.an),
      [NAMES[0]],
    );
  });

  await t.test('new admin account', async () => {
    await callFn('POST', '/users', {
      username: NAMES[3],
      password: 'Lang-genug-Passwort-1',
      is_admin: true,
      admin_password: PASS,
    });
    assert.deepEqual(await mails('admin_appointed', 2), [
      { an: NAMES[0], konto: NAMES[3], via: NAMES[0], name: undefined },
      { an: NAMES[1], konto: NAMES[3], via: NAMES[0], name: undefined },
    ]);
  });

  await t.test('appointed admin', async () => {
    sent.length = 0;
    await callFn('PUT', `/users/${user}/admin`, { is_admin: true, admin_password: PASS });
    assert.deepEqual(
      (await mails('admin_appointed', 3)).map(m => [m.an, m.konto]),
      [
        [NAMES[0], NAMES[2]],
        [NAMES[2], NAMES[2]],
        [NAMES[1], NAMES[2]],
      ],
    );
  });

  // `zwei` is an administrator: the change is announced and only applies in the cleanup run after the period.
  const due = async () => {
    await db.run(`UPDATE admin_takeovers SET effective_at = NOW() - INTERVAL '1 minute' WHERE target_id = $1`, [two]);
    assert.equal(await _req('src/account/adminActions.js').runDueTakeoversFrom(), 1);
  };

  await t.test('removed second factor', async () => {
    await db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', true)`, [two]);
    await callFn('DELETE', `/users/${two}/second-factor`, { admin_password: PASS });
    assert.deepEqual(
      (await mails('takeover_announced', 1)).map(m => [m.an, m.via]),
      [[NAMES[1], NAMES[0]]],
    );
    await due();
    assert.deepEqual(
      (await mails('second_factor_removed', 1)).map(m => [m.an, m.via]),
      [[NAMES[1], NAMES[0]]],
    );
    assert.deepEqual(
      (await mails('admin_factor_removed', 3)).map(m => [m.an, m.konto]),
      [
        [NAMES[0], NAMES[1]],
        [NAMES[2], NAMES[1]],
        [NAMES[1], NAMES[1]],
      ],
    );
  });

  await t.test('password set by an admin', async () => {
    await callFn('PUT', `/users/${two}/password`, { password: 'Neues-Langes-Passwort-9', admin_password: PASS });
    await due();
    assert.deepEqual(
      (await mails('password_by_admin', 1)).map(m => [m.an, m.via]),
      [[NAMES[1], NAMES[0]]],
    );
    assert.deepEqual(
      (await mails('admin_password_set', 3)).map(m => [m.an, m.konto]),
      [
        [NAMES[0], NAMES[1]],
        [NAMES[2], NAMES[1]],
        [NAMES[1], NAMES[1]],
      ],
    );
  });

  await t.test('token from login (new device)', async () => {
    sent.length = 0;
    await callFn('POST', '/login', { username: NAMES[2], password: PASS, label: 'Handy' });
    assert.deepEqual(await mails('token_added', 1), [
      { an: NAMES[2], konto: undefined, via: undefined, name: 'Handy' },
    ]);
  });

  await t.test('own second factor set up and switched off', async () => {
    const zf = _req('src/factors/secondFactor.js');
    const { secret } = await callFn('POST', '/second-factor/setup', { password: PASS });
    const code = offset => zf.hotp(zf.fromBase32(secret), zf.timeStep() + offset);
    await callFn('POST', '/second-factor/confirm', { code: code(0) });
    assert.deepEqual(
      (await mails('second_factor_enabled', 1)).map(m => m.an),
      [NAMES[0]],
    );
    await callFn('POST', '/second-factor/disable', { password: PASS, code: code(1) });
    assert.deepEqual(
      (await mails('second_factor_disabled', 1)).map(m => m.an),
      [NAMES[0]],
    );
  });
});
