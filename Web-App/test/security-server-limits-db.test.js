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
 *   H2  in moveSource again 403 kein_schreibrecht for foreign
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
const { warte } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

/** A request with a freely chosen Host header; fetch sets it itself. */
function withHost(port, host, pfad, kopf = {}) {
  return new Promise((fertig, fehler) => {
    const r = http.request({ host: '127.0.0.1', port, path: pfad, setHost: false, headers: { host, ...kopf } }, res => {
      let text = '';
      res.on('data', d => {
        text += d;
      });
      res.on('end', () => fertig({ status: res.statusCode, text }));
    });
    r.on('error', fehler);
    r.end();
  });
}

/** Raw connection: sends `roh`, collects the response and measures until closing. */
function roh(port, text) {
  const start = Date.now();
  const s = net.connect(port, '127.0.0.1', () => s.write(text));
  const ergebnis = { antwort: '', zu: null, socket: s };
  s.on('data', d => {
    ergebnis.antwort += d;
  });
  s.on('error', () => {});
  s.on('close', () => {
    ergebnis.zu = Date.now() - start;
  });
  return ergebnis;
}

test('server limits: slow requests, error texts, foreign hosts', {
  concurrency: 1,
  timeout: 240_000,
}, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const PASS = 'Runde-Elf-Passwort-7x',
    NAME = `r11_${process.pid}`;
  const namen = [`${NAME}_a`, `${NAME}_b`, `${NAME}_v`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const put = async (name, bestaetigt, token = null) =>
    (
      await db.get(
        `INSERT INTO users
    (username, email, password_hash, is_active, email_verified, verification_token, token_expires)
    VALUES ($1, $2, $3, true, $4, $5, CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() + INTERVAL '1 day' END) RETURNING id`,
        [name, `${name}@example.org`, bcrypt.hashSync(PASS, 4), bestaetigt, token],
      )
    ).id;
  const alice = await put(namen[0], true),
    bob = await put(namen[1], true);
  const MAILTOKEN = crypto.randomBytes(32).toString('hex');
  const unconfirmed = await put(namen[2], false, crypto.createHash('sha256').update(MAILTOKEN).digest('hex'));
  // Like POST /register since round 13: address and link only pending.
  await db.run(
    `UPDATE users SET new_email = email, new_email_token = verification_token, new_email_until = token_expires,
    email = NULL, verification_token = NULL, token_expires = NULL, registration_pending = true WHERE id = $1`,
    [unconfirmed],
  );
  t.after(async () => {
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [alice]);
    await db.run('DELETE FROM sets WHERE user_id = $1', [alice]);
    await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
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
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
    if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
  });
  const basis = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240 && (await fetch(`${basis}/api/v1/health/live`).catch(() => null)) === null; i++)
    await warte(250);

  const anmelden = async name => {
    const r = await fetch(`${basis}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: PASS, ohne_token: true }),
    });
    assert.equal(r.status, 200, `${await r.clone().text()}\n${log}`);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const keksA = await anmelden(namen[0]),
    keksB = await anmelden(namen[1]);
  const als =
    keks =>
    (pfad, o = {}) =>
      fetch(basis + pfad, {
        redirect: 'manual',
        ...o,
        headers: { cookie: keks, origin: basis, 'content-type': 'application/json', ...(o.headers || {}) },
      });

  await t.test('slow headers and bodies do not hold the server', async () => {
    const kopf = roh(port, 'POST /api/v1/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    const ohne = roh(
      port,
      'POST /api/v1/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
        'Content-Length: 200\r\n\r\n{',
    );
    const mit = roh(
      port,
      `POST /api/v1/vouchers HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${keksA}\r\nOrigin: ${basis}\r\n` +
        'Content-Type: application/json\r\nContent-Length: 200\r\n\r\n{',
    );
    try {
      for (const ende = Date.now() + 14_000; ohne.zu === null && Date.now() < ende; ) await warte(200);
      assert.ok(
        ohne.zu !== null && ohne.zu < 13_000,
        `ein stockender Rumpf ohne Anmeldung wird beendet (nach ${ohne.zu} ms)`,
      );
      assert.match(ohne.antwort, /^HTTP\/1\.1 408 [\s\S]*anfrage_zu_langsam/, ohne.antwort);
      await warte(1500);
      assert.equal(mit.zu, null, 'ein stockender Rumpf mit Anmeldung (Upload) läuft weiter: ' + mit.antwort);
      assert.equal(mit.antwort, '');
      for (const ende = Date.now() + 8_000; kopf.zu === null && Date.now() < ende; ) await warte(200);
      assert.ok(kopf.zu !== null && kopf.zu < 18_000, `ein stockender Kopf wird beendet (nach ${kopf.zu} ms)`);
      const r = await fetch(`${basis}/api/v1/health/live`);
      assert.equal(r.status, 200);
    } finally {
      for (const v of [kopf, ohne, mit]) v.socket.destroy();
    }
  });

  await t.test('4xx name no library text, own sentences stay', async () => {
    const prozent = await fetch(`${basis}/%`);
    const p = await prozent.json();
    assert.equal(prozent.status, 400);
    assert.equal(p.code, 'anfrage_ungueltig', `GET /% → ${JSON.stringify(p)}`);
    const gzip = await fetch(`${basis}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: 'kein gzip',
    });
    const g = await gzip.json();
    assert.equal(gzip.status, 400);
    assert.equal(g.code, 'anfrage_ungueltig', `gzip → ${JSON.stringify(g)}`);
    assert.doesNotMatch(JSON.stringify([p, g]), /decode|header check|zlib/i);
    const eigen = await als(keksA)('/api/v1/parts', {
      method: 'POST',
      body: JSON.stringify({ part_number: '!!', quantity: 1 }),
    });
    assert.equal(eigen.status, 400);
    assert.match((await eigen.json()).error, /part_number darf nur Buchstaben/, 'ein eigener Satz erreicht den Nutzer');
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
    const umhaengen = async id => {
      const r = await als(keksB)(`/api/v1/sets/10294-1/acquisitions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ owner_user_id: bob }),
      });
      return [r.status, await r.json()];
    };
    const fremd = await umhaengen(acq),
      fehlt = await umhaengen(2_000_000_000);
    assert.deepEqual(fremd, fehlt);
    assert.equal(fremd[0], 404);
    assert.equal(fremd[1].code, 'kaufpreis_nicht_gefunden');
    assert.equal(Number((await db.get('SELECT user_id FROM set_acquisitions WHERE id = $1', [acq])).user_id), alice);
  });

  await t.test('a foreign Host header is rejected, the own one is not', async () => {
    const fremd = await withHost(port, 'boese.example', '/api/v1/auth/me');
    assert.equal(fremd.status, 421, 'ein fremder Host-Kopf wird abgewiesen');
    assert.equal(JSON.parse(fremd.text).code, 'fremder_host');
    assert.equal((await withHost(port, `NAS.example.lan:${port}`, '/api/v1/auth/me')).status, 200);
    assert.equal((await withHost(port, 'nas.example.lan', '/api/v1/auth/me')).status, 200);
    assert.equal((await withHost(port, 'boese.example', '/api/v1/health/live')).status, 200);
    assert.notEqual((await withHost(port, 'boese.example', '/ca.crt')).status, 421);
    assert.equal(
      (await withHost(port, 'boese.example', '/api/v1/auth/me', { authorization: 'Bearer falsch' })).status,
      421,
      'ein Bearer-Kopf öffnet einen fremden Namen nicht',
    );
    for (const ip of [`192.168.1.20:${port}`, '10.0.0.5', '[fe80::1]:8080']) {
      assert.equal(
        (await withHost(port, ip, '/api/v1/auth/me', { authorization: 'Bearer falsch' })).status,
        401,
        `ein IP-Host (${ip}) geht an die Anmeldung`,
      );
    }
    assert.equal(
      (await withHost(port, '1.2.3.4.boese.example', '/api/v1/auth/me')).status,
      421,
      'ein Name mit Ziffern ist keine Adresse',
    );
  });

  await t.test('the link alone confirms nothing, only the POST', async () => {
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'email-bestaetigen|%'");
    // A link from an older mail (?token=) becomes a fragment before the page loads.
    const alt = await fetch(`${basis}/verify?token=${MAILTOKEN}`, { redirect: 'manual' });
    assert.equal(alt.status, 303, 'ein alter Link mit ?token= wird umgeleitet');
    assert.equal(alt.headers.get('location'), `/verify#token=${MAILTOKEN}`);
    assert.equal(alt.headers.get('cache-control'), 'no-store');
    const seite = await fetch(`${basis}/verify`, { redirect: 'manual' });
    assert.equal(seite.status, 200);
    assert.match(seite.headers.get('content-type'), /text\/html/);
    assert.equal(seite.headers.get('cache-control'), 'no-store');
    assert.match(await seite.text(), /id="panel-verify"/);
    const stand = async () =>
      (await db.get('SELECT email_verified FROM users WHERE id = $1', [unconfirmed])).email_verified;
    assert.equal(await stand(), false, 'der Link allein bestätigt nichts');
    const confirm = token =>
      fetch(`${basis}/api/v1/auth/email-bestaetigen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then(async r => [r.status, await r.json()]);
    assert.deepEqual((await confirm('falsch'))[1].code, 'bestaetigungslink_ungueltig');
    assert.deepEqual(await confirm(MAILTOKEN), [200, { success: true }]);
    assert.equal(await stand(), true);
    assert.equal((await confirm(MAILTOKEN))[0], 400, 'ein zweiter Klick meldet keinen zweiten Erfolg');
  });
});
