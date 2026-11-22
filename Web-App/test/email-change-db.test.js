/**
 * A new e-mail address requires the current password, and the old address
 * learns of it. Via the new address the password could otherwise be
 * reset: a briefly open foreign session would suffice for a takeover.
 *
 * Counter-checks (measured on 27.10.):
 *   A  the password check removed in the e-mail branch of PUT /profile → red:
 *      “without password", “wrong password", “with password" (the address was
 *      already changed in the first subtest)
 *   B  the hint to the old address removed → red: “with password"
 *      (no mail to the old address)
 *   C  `password` accepted again in PUT /profile → red: “password only via
 *      change-password"
 *   D  getBaseUrl() falls back to the Host header in production again → red:
 *      “in production without APP_BASE_URL no link from the Host header"
 *
 * Counter-checks for account enumeration (measured 03.11.2026):
 *   E  emailVergeben() again before the password check → red: “a taken
 *      address only reveals itself with password”
 *   F  accountThrottled() removed in PUT /profile → red: “assignment checks
 *      are throttled”
 *   G  password required again only for a new address → red: “even without a new
 *      address only with password” and “a taken username only reveals itself
 *      with password”
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
const gesendet = [];
const bestaetigt = [];
const versuche = [];
require('./helpers/sources').replaceServices('mail', {
  mailEmailChanged: async (an, name, neu) => {
    gesendet.push({ an, name, neu });
    return { success: true };
  },
  mailVerification: async (an, _token, basis) => {
    bestaetigt.push(basis);
    versuche.push({ an, kind: 'link' });
    return { success: true };
  },
  mailRegistrationAttempt: async (an, _language, reason) => {
    versuche.push({ an, kind: reason });
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
  const anderes = (
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
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, anderes]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t });
  const profileData = async body => {
    const r = await fetch(`${base}/api/v2/auth/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, ...body }),
    });
    return { status: r.status, body: await r.json() };
  };
  const address = async () => (await db.get('SELECT email FROM users WHERE id = $1', [uid])).email;

  await t.test('without password', async () => {
    const r = await profileData({ email: `${NAME}@neu.example` });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'current_password_required');
    assert.equal(await address(), `${NAME}@alt.example`);
  });

  await t.test('wrong password', async () => {
    const r = await profileData({ email: `${NAME}@neu.example`, password_current: 'falsch-falsch' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'current_password_wrong');
    assert.equal(await address(), `${NAME}@alt.example`);
  });

  await t.test('with password', async () => {
    const r = await profileData({ email: `${NAME}@neu.example`, password_current: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.emailChanged, true);
    assert.equal(await address(), `${NAME}@alt.example`, 'the new one only applies after the link (email-neu-db)');
    assert.deepEqual(
      gesendet,
      [{ an: `${NAME}@alt.example`, name: NAME, neu: `${NAME}@neu.example` }],
      'The previous address must learn that the account has a new one',
    );
  });

  await t.test('even without a new address only with password', async () => {
    const ohne = await profileData({ email: `${NAME}@neu.example`, first_name: 'Neu' });
    assert.deepEqual([ohne.status, ohne.body.code], [400, 'current_password_required']);
    assert.equal(
      (await profileData({ first_name: 'Neu', password_current: 'falsch-falsch' })).body.code,
      'current_password_wrong',
    );
    const mit = await profileData({ email: `${NAME}@neu.example`, first_name: 'Neu', password_current: PASS });
    assert.equal(mit.status, 200, JSON.stringify(mit.body));
    assert.equal((await db.get('SELECT first_name FROM users WHERE id = $1', [uid])).first_name, 'Neu');
  });

  await t.test('a taken username only reveals itself with password', async () => {
    assert.equal((await profileData({ username: `${NAME}_b` })).body.code, 'current_password_required');
    assert.equal(
      (await profileData({ username: `${NAME}_b`, password_current: 'falsch-falsch' })).body.code,
      'current_password_wrong',
    );
  });

  await t.test('in production without APP_BASE_URL no link from the Host header', async () => {
    const vorher = { env: process.env.NODE_ENV, basis: process.env.APP_BASE_URL };
    environment({ NODE_ENV: 'production' });
    environment({ APP_BASE_URL: undefined });
    try {
      bestaetigt.length = 0;
      const r = await profileData({ email: `${NAME}@drei.example`, password_current: PASS });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.emailSent, false);
      assert.deepEqual(bestaetigt, [], 'without a fixed address no link may be sent');
      environment({ APP_BASE_URL: 'https://lego.example.org/' });
      await profileData({ email: `${NAME}@vier.example`, password_current: PASS });
      assert.deepEqual(bestaetigt, ['https://lego.example.org']);
    } finally {
      environment({ NODE_ENV: vorher.env });
      if (vorher.basis === undefined) environment({ APP_BASE_URL: undefined });
      else environment({ APP_BASE_URL: vorher.basis });
    }
  });

  await t.test('a taken address answers like a free one', async () => {
    const belegt = `${NAME}@belegt.example`;
    assert.equal((await profileData({ email: belegt })).body.code, 'current_password_required');
    assert.equal(
      (await profileData({ email: belegt, password_current: 'falsch-falsch' })).body.code,
      'current_password_wrong',
    );
    environment({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      versuche.length = 0;
      const frei = await profileData({ email: `${NAME}@frei.example`, password_current: PASS });
      const vergeben = await profileData({ email: belegt.toUpperCase(), password_current: PASS });
      assert.deepEqual(vergeben, frei, 'Status and fields equal');
      assert.deepEqual(frei, { status: 200, body: { success: true, emailChanged: true, emailSent: true } });
      // The owner of the taken address gets a hint instead of a link.
      assert.deepEqual(versuche, [
        { an: `${NAME}@frei.example`, kind: 'link' },
        { an: belegt, kind: 'adresse' },
      ]);
      assert.equal(await address(), `${NAME}@alt.example`);
    } finally {
      environment({ APP_BASE_URL: undefined });
    }
  });

  await t.test('availability checks are throttled', async () => {
    const codes = [];
    for (let i = 0; i < 12; i++)
      codes.push((await profileData({ username: `${NAME}_b`, password_current: PASS })).body.code);
    assert.equal(codes[0], 'username_taken');
    const ab = codes.indexOf('too_many_requests');
    assert.ok(ab > 0, codes.join(', '));
    assert.ok(
      codes.slice(ab).every(c => c === 'too_many_requests'),
      codes.join(', '),
    );
  });

  await t.test('password only via change-password', async () => {
    const vorher = (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash;
    const r = await profileData({ password: 'GanzNeuesPasswort1', password_current: PASS });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'password_via_change_password');
    assert.equal((await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash, vorher);
  });
});
