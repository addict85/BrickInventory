/**
 * Forgot-password against a real database: e-mail comparison ignoring
 * upper/lower case.
 *
 * Counter-check (performed): LOWER($1) in routes/auth.ts turned back to $1
 * → exactly the first substep here turns red.
 *
 * Second test: without APP_BASE_URL no reset link goes out, not even with NODE_ENV=development.
 * Counter-checks (25.10., measured):
 *   A  resetLinkMoeglich() always returns true → red: “reset code to the host from the header"
 *   B  check only after the user search, with 200 for unknown ones → red: “reveals the e-mail"
 *   C  (01.11., measured) lock in forgot-password again only at NODE_ENV=production → red: “reset code
 *      to the host from the header"
 * Third test, counter-checks (01.11., measured): pause condition removed in the UPDATE → red
 *   “second link within the pause”; minimum duration removed → red “the duration reveals the address”
 *
 * Prerequisite: test DB (content is changed!) via TEST_DATABASE_URL.
 * Without DB: skip.
 */
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Links in mails only exist with a fixed address (routes/auth.ts, getBaseUrl).
environment({ APP_BASE_URL: 'http://localhost' });
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
// Read the address from server.ts — see einhaengung() in helpers/sources.js.
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

// Close the pool, otherwise it keeps the process alive and the file runs into
// the runner's timeout.
test.after(() => db.pool.end().catch(() => {}));

test('forgot-password finds the email regardless of case', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const USERNAME = 'forgotcasetest';
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  // The endpoint's ipThrottle (5/h) counts in rate_limit_attempts and
  // SURVIVES processes — this test makes four calls from the same address,
  // a second run within the hour would otherwise run into 429.
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-%'`).catch(() => {});
  const hash = await bcrypt.hash('passwort123', 4);
  // Registered with mixed case — exactly as the
  // registration stores the address (unchanged, as entered).
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, 'Forgot.Case@Example.CH', $2, false, true, true)`,
    [USERNAME, hash],
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {};
    next();
  });
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const port = srv.address().port;

  const forgot = async email => {
    const r = await fetch(`http://localhost:${port}${AUTH}/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.success, true, 'the response is ALWAYS success:true (anti-enumeration)');
    // The truth is not in the response but in the table.
    const row = await db.get(`SELECT reset_token FROM users WHERE username = $1`, [USERNAME]);
    const gesetzt = !!row.reset_token;
    await db.run(`UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE username = $1`, [USERNAME]);
    return gesetzt;
  };

  try {
    assert.equal(await forgot('forgot.case@example.ch'), true, 'Lower case must find the mixed-case address');
    assert.equal(await forgot('FORGOT.CASE@EXAMPLE.CH'), true, 'Upper case must find the mixed-case address');
    assert.equal(await forgot('Forgot.Case@Example.CH'), true, 'the exact spelling still works');
    assert.equal(await forgot('gibt.es.nicht@example.ch'), false, 'an unknown address still sets NO token');
  } finally {
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
  }
});

test('reset link only with APP_BASE_URL, never from the Host header — even outside production', {
  concurrency: 1,
}, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const USERNAME = 'forgothosttest';
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-%'`).catch(() => {});
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, 'forgot.host@example.ch', 'x', false, true, true)`,
    [USERNAME],
  );

  const alt = {
    NODE_ENV: process.env.NODE_ENV,
    APP_BASE_URL: process.env.APP_BASE_URL,
    SMTP_HOST: process.env.SMTP_HOST,
  };
  environment({ NODE_ENV: 'development' });
  delete process.env.SMTP_HOST;
  const output = [];
  const altLog = console.log,
    altWarn = console.warn;
  console.log = (...a) => {
    output.push(a.join(' '));
  };
  console.warn = (...a) => {
    output.push(a.join(' '));
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {};
    next();
  });
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const port = srv.address().port;
  const forgot = async email => {
    const r = await fetch(`http://localhost:${port}${AUTH}/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-host': 'boese.example', host: 'boese.example' },
      body: JSON.stringify({ email }),
    });
    const row = await db.get(`SELECT reset_token FROM users WHERE username = $1`, [USERNAME]);
    await db.run(`UPDATE users SET reset_token = NULL WHERE username = $1`, [USERNAME]);
    return { status: r.status, body: await r.json(), token: !!row.reset_token };
  };
  const waitOnLink = async () => {
    for (let i = 0; i < 50 && !output.some(z => z.includes('Link:')); i++) await new Promise(r => setTimeout(r, 50));
    return output.find(z => z.includes('Link:')) || '';
  };

  try {
    environment({ APP_BASE_URL: undefined });
    const bekannt = await forgot('forgot.host@example.ch');
    const unbekannt = await forgot('gibt.es.nicht@example.ch');
    assert.equal(bekannt.token, false, 'Reset code to the host from the header — without APP_BASE_URL none may arise');
    assert.equal(bekannt.status, 503);
    assert.equal(bekannt.body.code, 'password_reset_not_configured');
    assert.deepEqual(unbekannt, bekannt, 'The response reveals the e-mail: known and unknown differ');

    environment({ APP_BASE_URL: 'https://lego.example.org/' });
    output.length = 0;
    const mit = await forgot('forgot.host@example.ch');
    assert.equal(mit.status, 200);
    assert.equal(mit.token, true);
    const link = await waitOnLink();
    assert.match(link, /https:\/\/lego\.example\.org\/reset-password#token=…$/, 'the token is in the fragment');
    assert.doesNotMatch(link, /boese/);
  } finally {
    console.log = altLog;
    console.warn = altWarn;
    for (const [k, v] of Object.entries(alt)) {
      if (v === undefined) environment({ [k]: undefined });
      else environment({ [k]: v });
    }
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
  }
});

test('at most one link per account in 15 minutes, and every response takes equally long', {
  concurrency: 1,
}, async t => {
  const USERNAME = `forgotpause_${process.pid}`;
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-%'`);
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_active, email_verified)
                VALUES ($1, $2, 'x', true, true)`,
    [USERNAME, `${USERNAME}@example.ch`],
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {};
    next();
  });
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  t.after(async () => {
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
  });
  const forgot = async email => {
    const start = Date.now();
    const r = await fetch(`http://localhost:${srv.address().port}${AUTH}/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const duration = Date.now() - start;
    const z = await db.get(`SELECT reset_token FROM users WHERE username = $1`, [USERNAME]);
    return { status: r.status, body: await r.json(), duration, token: z.reset_token };
  };
  const erste = await forgot(`${USERNAME}@example.ch`);
  assert.ok(erste.token);
  const zweite = await forgot(`${USERNAME}@example.ch`);
  assert.equal(zweite.token, erste.token, 'second link within the pause — the mailbox can be flooded');
  assert.deepEqual(zweite.body, erste.body, 'the response reveals the pause');
  // After the pause (expiry lies less than 45 minutes ahead) there is one again.
  await db.run(`UPDATE users SET reset_token_expires = NOW() + INTERVAL '44 minutes' WHERE username = $1`, [USERNAME]);
  assert.notEqual((await forgot(`${USERNAME}@example.ch`)).token, erste.token, 'no new link after the pause');
  const unbekannt = await forgot(`gibt.es.nicht.${process.pid}@example.ch`);
  for (const r of [erste, zweite, unbekannt])
    assert.ok(r.duration >= 390, `Response after ${r.duration} ms — the duration reveals the address`);
});
