/**
 * A password assigned by an administrator (new account or foreign password
 * set) only applies until the first login: afterwards the server only allows
 * the change (403 password_change_required), only the own password
 * opens the rest. On the real server (dist/server.js) with a real administrator
 * including second factor.
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  in setPasswordHash() `must_change_password = true` removed → red:
 *      “a password set by the administrator …” (mustChangePassword false,
 *      /stats 200)
 *   B  in addAccountOne() the column omitted again → red: “an account
 *      created by the administrator …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { adminWithFactor, takeoverNow } = require('./helpers/admin');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { until } = require('./helpers/time');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

test('passwords assigned by an admin only apply until the first change', {
  concurrency: 1,
  timeout: 180_000,
}, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    CHEF = `vpe_chef_${P}`,
    ALT = `vpe_alt_${P}`,
    NEW = `vpe_neu_${P}`;
  const CHEF_PW = 'Verwalter-Passwort-17x';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ALT, NEW]]);
  const put = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
        [name, bcrypt.hashSync(CHEF_PW, 4), admin],
      )
    ).id;
  const chef = await put(CHEF, true),
    alt = await put(ALT, false);
  const codes = await adminWithFactor(_req, chef);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ALT, NEW]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'verwalter-pw-test-geheimnis-lang-genug-123',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLE: 'web',
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
    await until(() => srv.exitCode !== null || srv.signalCode !== null, 4000);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  assert.ok(
    await until(async () => (await fetch(`${basis}/api/v2/health/live`).catch(() => null)) !== null, 60_000),
    `the server does not start:\n${log.slice(-2000)}`,
  );

  const callFn = (keks, path, o = {}) =>
    fetch(basis + path, {
      ...o,
      headers: { 'content-type': 'application/json', origin: basis, ...(keks ? { cookie: keks } : {}) },
    });
  const signIn = async (name, password, code) => {
    const r = await callFn(null, '/api/v2/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: name, password: password, without_token: true, ...(code ? { code } : {}) }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(body)}\n${log.slice(-800)}`);
    return { keks: r.headers.get('set-cookie').split(';')[0], user: body.user };
  };
  const chefKeks = (await signIn(CHEF, CHEF_PW, codes[0])).keks;

  /** Log in, locked until the change, open after the change. */
  async function onlyUntilToSwitch(name, taken) {
    const a = await signIn(name, taken);
    assert.equal(a.user.mustChangePassword, true, 'the sign-in reports the mandatory change');
    const locked = await callFn(a.keks, '/api/v2/stats');
    assert.equal(locked.status, 403);
    assert.equal((await locked.json()).code, 'password_change_required');
    const w = await callFn(a.keks, '/api/v2/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current: taken, newPassword: `Eigenes-Passwort-${P}-neu` }),
    });
    assert.equal(w.status, 200, await w.clone().text());
    const keks = w.headers.get('set-cookie').split(';')[0];
    assert.equal((await callFn(keks, '/api/v2/stats')).status, 200);
  }

  await t.test('an account created by an admin', async () => {
    const taken = 'Vom-Verwalter-vergeben-1';
    const r = await callFn(chefKeks, '/api/v2/auth/users', {
      method: 'POST',
      body: JSON.stringify({ username: NEW, password: taken, admin_password: CHEF_PW, code: codes[1] }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    await onlyUntilToSwitch(NEW, taken);
  });

  await t.test('a password set by an admin', async () => {
    const taken = 'Vom-Verwalter-gesetzt-2';
    const r = await callFn(chefKeks, `/api/v2/auth/users/${alt}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password: taken, admin_password: CHEF_PW, code: codes[2] }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    // Announced like every takeover; here only what applies after the deadline counts.
    assert.equal(await takeoverNow(_req, db, alt), 1);
    await onlyUntilToSwitch(ALT, taken);
  });
});
