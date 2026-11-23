/**
 * Findings of the tenth security review on the real server (dist/server.js):
 * slow requests, error texts on 4xx, oracle for acquisition IDs, foreign
 * Host header, email confirmation only via POST.
 *
 * Counter-checks (measured 04.11.2026, each on its own, built afterwards):
 *   M1a `headersTimeout` deleted from the deadlines in server.ts → red: „ein
 *       stockender Kopf …“ (Node default 60 s, check after 18 s)
 *   M1b `onlyIf(anonymous, bodyDeadline)` deleted from readBody → red:
 *       „ein stockender Rumpf ohne Anmeldung …“
 *   M1c the condition `anonymous` left out (deadline for everybody) → red: „ein
 *       stockender Rumpf mit Anmeldung …“
 *   H1  in handleRouteError the branch for 4xx without code deleted → red:
 *       „GET /% …“ (response „Failed to decode param '%'“); `fail()` in
 *       validate.ts again with `new Error` → red: „ein eigener Satz …“
 *   H2  in moveSource again 403 no_write_access for foreign
 *       rows → red: “a foreign entry responds like a missing one”
 *   H4  `app.use(onlyOwnHost)` deleted in server.ts → red: „ein fremder
 *       Host-Kopf …“; the exception for IP addresses deleted → red: „IP-Host“; bearer again
 *       as an exception → red: „öffnet einen fremden Namen nicht“
 *   H5  GET /verify confirms by itself again (verifyEmailToken in the handler)
 *       → red: „der Link allein bestätigt nichts“
 *
 * Token in the fragment instead of in the query (measured 13.11.2026):
 *   N2  tokenToFragment() never redirects → red: „ein
 *       alter Link mit ?token= wird umgeleitet“ (200 instead of 303)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { sleep } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

/** A request with a freely chosen Host header; fetch sets it itself. */
function withHost(port, host, path, head = {}) {
  return new Promise((done, error) => {
    const r = http.request({ host: '127.0.0.1', port, path: path, setHost: false, headers: { host, ...head } }, res => {
      let text = '';
      res.on('data', d => {
        text += d;
      });
      res.on('end', () => done({ status: res.statusCode, text }));
    });
    r.on('error', error);
    r.end();
  });
}

/** Raw connection: sends `text`, collects the response and measures until closing. */
function raw(port, text) {
  const start = Date.now();
  const s = net.connect(port, '127.0.0.1', () => s.write(text));
  const outcome = { response: '', closed: null, socket: s };
  s.on('data', d => {
    outcome.response += d;
  });
  s.on('error', () => {});
  s.on('close', () => {
    outcome.closed = Date.now() - start;
  });
  return outcome;
}

test('server limits: slow requests, error texts, foreign hosts', {
  concurrency: 1,
  timeout: 240_000,
}, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const PASS = 'Runde-Elf-Passwort-7x',
    NAME = `r11_${process.pid}`;
  const names = [`${NAME}_a`, `${NAME}_b`, `${NAME}_v`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
  const put = async (name, confirmed, token = null) =>
    (
      await db.get(
        `INSERT INTO users
    (username, email, password_hash, is_active, email_verified, verification_token, token_expires)
    VALUES ($1, $2, $3, true, $4, $5, CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() + INTERVAL '1 day' END) RETURNING id`,
        [name, `${name}@example.org`, bcrypt.hashSync(PASS, 4), confirmed, token],
      )
    ).id;
  const alice = await put(names[0], true),
    bob = await put(names[1], true);
  const MAIL_TOKEN = crypto.randomBytes(32).toString('hex');
  const unconfirmed = await put(names[2], false, crypto.createHash('sha256').update(MAIL_TOKEN).digest('hex'));
  // Like POST /register since round 13: address and link only pending.
  await db.run(
    `UPDATE users SET new_email = email, new_email_token = verification_token, new_email_until = token_expires,
    email = NULL, verification_token = NULL, token_expires = NULL, registration_pending = true WHERE id = $1`,
    [unconfirmed],
  );
  t.after(async () => {
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [alice]);
    await db.run('DELETE FROM sets WHERE user_id = $1', [alice]);
    await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
    await db.pool.end().catch(() => {});
  });

  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: URL_DB,
      SESSION_SECRET: 'runde-elf-test-geheimnis-lang-genug-12345',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLE: 'web',
      APP_BASE_URL: `http://nas.example.lan:${port}`,
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
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await sleep(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240 && (await fetch(`${basis}/api/v2/health/live`).catch(() => null)) === null; i++)
    await sleep(250);

  const signIn = async name => {
    const r = await fetch(`${basis}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: PASS, without_token: true }),
    });
    assert.equal(r.status, 200, `${await r.clone().text()}\n${log}`);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const keksA = await signIn(names[0]),
    keksB = await signIn(names[1]);
  const as =
    keks =>
    (path, o = {}) =>
      fetch(basis + path, {
        redirect: 'manual',
        ...o,
        headers: { cookie: keks, origin: basis, 'content-type': 'application/json', ...(o.headers || {}) },
      });

  await t.test('slow headers and bodies do not hold the server', async () => {
    const head = raw(port, 'POST /api/v2/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    const without = raw(
      port,
      'POST /api/v2/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
        'Content-Length: 200\r\n\r\n{',
    );
    const withIt = raw(
      port,
      `POST /api/v2/vouchers HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${keksA}\r\nOrigin: ${basis}\r\n` +
        'Content-Type: application/json\r\nContent-Length: 200\r\n\r\n{',
    );
    try {
      for (const end = Date.now() + 14_000; without.closed === null && Date.now() < end; ) await sleep(200);
      assert.ok(
        without.closed !== null && without.closed < 13_000,
        `a stalling body without login is terminated (after ${without.closed} ms)`,
      );
      assert.match(without.response, /^HTTP\/1\.1 408 [\s\S]*request_too_slow/, without.response);
      await sleep(1500);
      assert.equal(withIt.closed, null, 'a stalling body with login (upload) keeps running: ' + withIt.response);
      assert.equal(withIt.response, '');
      for (const end = Date.now() + 8_000; head.closed === null && Date.now() < end; ) await sleep(200);
      assert.ok(
        head.closed !== null && head.closed < 18_000,
        `a stalling header is terminated (after ${head.closed} ms)`,
      );
      const r = await fetch(`${basis}/api/v2/health/live`);
      assert.equal(r.status, 200);
    } finally {
      for (const v of [head, without, withIt]) v.socket.destroy();
    }
  });

  await t.test('4xx name no library text, own sentences stay', async () => {
    const percentValue = await fetch(`${basis}/%`);
    const p = await percentValue.json();
    assert.equal(percentValue.status, 400);
    assert.equal(p.code, 'request_invalid', `GET /% → ${JSON.stringify(p)}`);
    const gzip = await fetch(`${basis}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: 'kein gzip',
    });
    const g = await gzip.json();
    assert.equal(gzip.status, 400);
    assert.equal(g.code, 'request_invalid', `gzip → ${JSON.stringify(g)}`);
    assert.doesNotMatch(JSON.stringify([p, g]), /decode|header check|zlib/i);
    const own = await as(keksA)('/api/v2/parts', {
      method: 'POST',
      body: JSON.stringify({ part_number: '!!', quantity: 1 }),
    });
    assert.equal(own.status, 400);
    assert.match((await own.json()).error, /part_number darf nur Buchstaben/, 'an own sentence reaches the user');
  });

  await t.test('a foreign entry responds like a missing one', async () => {
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10294-1') ON CONFLICT DO NOTHING`, [alice]);
    const acq = (
      await db.get(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, condition, currency)
      VALUES ($1, '10294-1', 1, 'N', 'CHF') RETURNING id`,
        [alice],
      )
    ).id;
    const reassign = async id => {
      const r = await as(keksB)(`/api/v2/sets/10294-1/acquisitions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ owner_user_id: bob }),
      });
      // request_id differs per request by design; the rest must not tell the two apart.
      const { request_id: _rid, ...body } = await r.json();
      return [r.status, body];
    };
    const fremd = await reassign(acq),
      missing = await reassign(2_000_000_000);
    assert.deepEqual(fremd, missing);
    assert.equal(fremd[0], 404);
    assert.equal(fremd[1].code, 'purchase_price_not_found');
    assert.equal(Number((await db.get('SELECT user_id FROM set_acquisitions WHERE id = $1', [acq])).user_id), alice);
  });

  await t.test('a foreign Host header is rejected, the own one is not', async () => {
    const fremd = await withHost(port, 'boese.example', '/api/v2/auth/me');
    assert.equal(fremd.status, 421, 'a foreign Host header is rejected');
    assert.equal(JSON.parse(fremd.text).code, 'foreign_host');
    assert.equal((await withHost(port, `NAS.example.lan:${port}`, '/api/v2/auth/me')).status, 200);
    assert.equal((await withHost(port, 'nas.example.lan', '/api/v2/auth/me')).status, 200);
    assert.equal((await withHost(port, 'boese.example', '/api/v2/health/live')).status, 200);
    assert.notEqual((await withHost(port, 'boese.example', '/ca.crt')).status, 421);
    assert.equal(
      (await withHost(port, 'boese.example', '/api/v2/auth/me', { authorization: 'Bearer falsch' })).status,
      421,
      'a bearer header does not open a foreign name',
    );
    for (const ip of [`192.168.1.20:${port}`, '10.0.0.5', '[fe80::1]:8080']) {
      assert.equal(
        (await withHost(port, ip, '/api/v2/auth/me', { authorization: 'Bearer falsch' })).status,
        401,
        `an IP host (${ip}) goes to the login`,
      );
    }
    assert.equal(
      (await withHost(port, '1.2.3.4.boese.example', '/api/v2/auth/me')).status,
      421,
      'a name with digits is no address',
    );
  });

  await t.test('the link alone confirms nothing, only the POST', async () => {
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'email-bestaetigen|%'");
    // A link from an older mail (?token=) becomes a fragment before the page loads.
    const alt = await fetch(`${basis}/verify?token=${MAIL_TOKEN}`, { redirect: 'manual' });
    assert.equal(alt.status, 303, 'an old link with ?token= is redirected');
    assert.equal(alt.headers.get('location'), `/verify#token=${MAIL_TOKEN}`);
    assert.equal(alt.headers.get('cache-control'), 'no-store');
    const page = await fetch(`${basis}/verify`, { redirect: 'manual' });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(await page.text(), /id="panel-verify"/);
    const state = async () =>
      (await db.get('SELECT email_verified FROM users WHERE id = $1', [unconfirmed])).email_verified;
    assert.equal(await state(), false, 'the link alone confirms nothing');
    const confirm = token =>
      fetch(`${basis}/api/v2/auth/confirm-email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then(async r => [r.status, await r.json()]);
    assert.deepEqual((await confirm('falsch'))[1].code, 'confirmation_link_invalid');
    assert.deepEqual(await confirm(MAIL_TOKEN), [200, { success: true }]);
    assert.equal(await state(), true);
    assert.equal((await confirm(MAIL_TOKEN))[0], 400, 'a second click reports no second success');
  });
});
