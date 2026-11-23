/**
 * E-mail verification against a REAL database.
 *
 * ── Counter-checks (measured 04.11.2026, each alone) ────────────────────────
 * Since round 13 a registration carries address and link in new_email*.
 *   A  in adoptEmailNew() `AND new_email_until > NOW()` deleted → red:
 *      “expired token is rejected …”
 *   B  adoptEmailNew() without `registration_pending = false` → red: “valid
 *      token …” (the registration would stay open and locked)
 *   C  adoptEmailNew() without the repeated assignment check AND without catching
 *      23505 → red: “the first confirmation wins …” (error from the index;
 *      each of the two alone holds)
 *
 * Prerequisite: test DB (content is emptied!) via TEST_DATABASE_URL.
 * Without DB: skip — unless REQUIRE_DB=1, then error.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { verifyEmailToken } = _req('src/account/loginCheck.js');
const INVALID = { code: 'confirmation_link_invalid' };
const { tokenDigest } = _req('src/account/deviceToken.js');

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // And the MIGRATIONS, not only the schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }
}

/** An open registration as POST /register creates it. `minutesValid` negative =
 * expired. Returns the RAW token — the DB only holds its SHA-256. */
async function newUser(name, { minutesValid = 60, email = `${name}@example.ch` } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const { id } = await db.get(
    `INSERT INTO users (username, password_hash, new_email, new_email_token, new_email_until, registration_pending)
     VALUES ($1, 'x', $2, $3, NOW() + ($4 || ' minutes')::interval, true) RETURNING id`,
    [name, email, tokenDigest(token), String(minutesValid)],
  );
  return { id, token };
}

const condition = id =>
  db.get(
    'SELECT email, email_verified, registration_pending, new_email, new_email_token, new_email_until FROM users WHERE id=$1',
    [id],
  );

test('email verification against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await seed();

  await t.test('valid token: sets email_verified and clears the fields', async () => {
    const u = await newUser('gueltig');
    assert.deepEqual(await verifyEmailToken(u.token), { userId: u.id }, 'A fresh token must be redeemable');
    assert.deepEqual(await condition(u.id), {
      email: 'gueltig@example.ch',
      email_verified: true,
      registration_pending: false,
      new_email: null,
      new_email_token: null,
      new_email_until: null,
    });
  });

  await t.test('an expired token is rejected and changes nothing', async () => {
    const u = await newUser('abgelaufen', { minutesValid: -5 });
    await assert.rejects(verifyEmailToken(u.token), INVALID);
    const z = await condition(u.id);
    assert.deepEqual(
      [z.email, z.email_verified, z.registration_pending],
      [null, false, true],
      'An expired token confirmed',
    );
    assert.notEqual(z.new_email_token, null, 'The fields were wrongly cleared');
  });

  await t.test('an unknown token is rejected', async () => {
    await assert.rejects(verifyEmailToken('gibtesnicht'), INVALID);
  });

  await t.test('a missing token is rejected', async () => {
    for (const empty of [undefined, null, '', '   '])
      await assert.rejects(verifyEmailToken(empty), INVALID, `${JSON.stringify(empty)} was accepted`);
  });

  await t.test('redeeming the same token a second time fails', async () => {
    const u = await newUser('zweimal');
    await verifyEmailToken(u.token);
    await assert.rejects(verifyEmailToken(u.token), INVALID, 'The same link could be redeemed a second time');
  });

  await t.test('the first confirmation wins, the second registration stays open', async () => {
    const first = await newUser('erste', { email: 'geteilt@example.ch' });
    const second = await newUser('zweite', { email: 'GETEILT@example.ch' });
    await verifyEmailToken(first.token);
    await assert.rejects(verifyEmailToken(second.token), { code: 'email_taken' });
    const z = await condition(second.id);
    assert.deepEqual([z.email, z.registration_pending, z.new_email_token], [null, true, null]);
  });

  // The five cases via the API route are REMOVED

  await db.pool.end().catch(() => {});
});
