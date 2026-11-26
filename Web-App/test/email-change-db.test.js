/**
 * A new e-mail address needs only the login (docs/SICHERHEIT.md), and the old
 * address learns of it; the new one applies only after its link.
 *
 * Counter-checks (measured on 27.10.):
 *   B  the hint to the old address removed → red: “a new address needs only
 *      the login …” (no mail to the old address)
 *   C  `password` accepted again in PUT /profile → red: “password only via
 *      change-password"
 *   D  getBaseUrl() falls back to the Host header in production again → red:
 *      “in production without APP_BASE_URL no link from the Host header"
 *   A  (26.11.2026) a password check back into PUT /profile → red: “a new
 *      address needs only the login …” and “other fields too” (400 instead of 200)
 *
 * Counter-checks for account enumeration (measured 03.11.2026):
 *   F  accountThrottled() removed in PUT /profile → red: “assignment checks
 *      are throttled”
 * Counter-check round 17 (measured 05.11.2026):
 *   H  the pre-check `emailVergeben → 400 email_taken` rebuilt →
 *      red: “a taken address answers like a free one”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

// Record sent hints before routes/auth binds the mail functions.
const sent = [];
const confirmed = [];
const attempts = [];
require('./helpers/sources').replaceServices('mail', {
  mailEmailChanged: async (an, name, fresh) => {
    sent.push({ an, name, fresh });
    return { success: true };
  },
  mailVerification: async (an, _token, basis) => {
    confirmed.push(basis);
    attempts.push({ an, kind: 'link' });
    return { success: true };
  },
  mailRegistrationAttempt: async (an, _language, reason) => {
    attempts.push({ an, kind: reason });
    return { success: true };
  },
});

const db = testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const NAME = `mailneu_${process.pid}`,
  PASS = 'Passwort12345';

test('change email', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_b`]]);
  const another = (
    await db.get(`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [
      `${NAME}_b`,
      `${NAME}@belegt.example`,
    ])
  ).id;
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
     VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@alt.example`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, another]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { session: { userId: uid, username: NAME }, t });
  const profileData = async body => {
    const r = await fetch(`${base}/api/v2/auth/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, ...body }),
    });
    return { status: r.status, body: await r.json() };
  };
  const address = async () => (await db.get('SELECT email FROM users WHERE id = $1', [uid])).email;

  await t.test('a new address needs only the login, the old one learns of it', async () => {
    const r = await profileData({ email: `${NAME}@neu.example` });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.emailChanged, true);
    assert.equal(await address(), `${NAME}@alt.example`, 'the new one only applies after the link (email-neu-db)');
    assert.deepEqual(
      sent,
      [{ an: `${NAME}@alt.example`, name: NAME, fresh: `${NAME}@neu.example` }],
      'The previous address must learn that the account has a new one',
    );
  });

  await t.test('other fields too', async () => {
    const r = await profileData({ email: `${NAME}@neu.example`, first_name: 'Neu' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await db.get('SELECT first_name FROM users WHERE id = $1', [uid])).first_name, 'Neu');
  });

  await t.test('in production without APP_BASE_URL no link from the Host header', async () => {
    const prior = { env: process.env.NODE_ENV, basis: process.env.APP_BASE_URL };
    environment({ NODE_ENV: 'production' });
    environment({ APP_BASE_URL: undefined });
    try {
      confirmed.length = 0;
      const r = await profileData({ email: `${NAME}@drei.example` });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.emailSent, false);
      assert.deepEqual(confirmed, [], 'without a fixed address no link may be sent');
      environment({ APP_BASE_URL: 'https://lego.example.org/' });
      await profileData({ email: `${NAME}@vier.example` });
      assert.deepEqual(confirmed, ['https://lego.example.org']);
    } finally {
      environment({ NODE_ENV: prior.env });
      if (prior.basis === undefined) environment({ APP_BASE_URL: undefined });
      else environment({ APP_BASE_URL: prior.basis });
    }
  });

  await t.test('a taken address answers like a free one', async () => {
    const occupied = `${NAME}@belegt.example`;
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      attempts.length = 0;
      const free = await profileData({ email: `${NAME}@frei.example` });
      const taken = await profileData({ email: occupied.toUpperCase() });
      assert.deepEqual(taken, free, 'Status and fields equal');
      assert.deepEqual(free, { status: 200, body: { success: true, emailChanged: true, emailSent: true } });
      // The owner of the taken address gets a hint instead of a link.
      assert.deepEqual(attempts, [
        { an: `${NAME}@frei.example`, kind: 'link' },
        { an: occupied, kind: 'adresse' },
      ]);
      assert.equal(await address(), `${NAME}@alt.example`);
    } finally {
      environment({ APP_BASE_URL: undefined });
    }
  });

  await t.test('availability checks are throttled', async () => {
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await profileData({ username: `${NAME}_b` })).body.code);
    assert.equal(codes[0], 'username_taken');
    const ab = codes.indexOf('too_many_requests');
    assert.ok(ab > 0, codes.join(', '));
    assert.ok(
      codes.slice(ab).every(c => c === 'too_many_requests'),
      codes.join(', '),
    );
  });

  await t.test('password only via change-password', async () => {
    const prior = (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash;
    const r = await profileData({ password: 'GanzNeuesPasswort1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'password_via_change_password');
    assert.equal((await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash, prior);
  });
});
