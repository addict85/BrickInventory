/**
 * A login attempt must not reveal whether the account exists: an unknown
 * name also computes exactly one hash with the costs of a real account (DUMMY_HASH).
 * Counted instead of timed: argon2id costs hardly more than the fluctuating database work.
 *
 * Counter-checks (measured 14.11.2026, each on its own):
 *   A  in checkCredentials() without a hit no comparison against DUMMY_HASH → red:
 *      “unknown: exactly one hash” (0 instead of 1)
 *   B  DUMMY_HASH with lower costs (memoryCost 4096) → red: “unknown: the same
 *      costs as a real account”
 *
 * Prerequisite: test DB (contents are touched!) via TEST_DATABASE_URL.
 * Without DB: skip. Run: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const argon2 = require('@node-rs/argon2');
const { checkCredentials } = _req('src/account/loginCheck.js');
const { hashPassword } = _req('src/account/passwordHash.js');

/** Minimal request: checkCredentials only needs the IP of it (counter). */
const request = (i = 7) => ({ ip: `203.0.113.${i}`, headers: {}, socket: {} });
/** Costs of an argon2 hash: everything before the salt. */
const cost = (/** @type {string} */ hash) => hash.split('$').slice(0, 4).join('$');

test('an unknown login name computes the same hash as a wrong password', async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const name = 'zeit_bekannt';
  const hash = await hashPassword('richtigesPasswort1');
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,false,true,true)',
    [name, hash],
  );

  try {
    /** @type {string[]} */
    let computed = [];
    const original = argon2.verify;
    t.mock.method(argon2, 'verify', (/** @type {string} */ h, /** @type {any[]} */ ...rest) => {
      computed.push(h);
      return /** @type {any} */ (original)(h, ...rest);
    });

    // One attempt each with its own name and own IP: a second one would at some point run into the brake.
    for (const [was, who, ip] of /** @type {const} */ ([
      ['bekannt', name, 10],
      ['unbekannt', 'zeit_gibtsnicht', 20],
    ])) {
      computed = [];
      const r = await checkCredentials(request(ip), who, 'falschesPasswort1');
      // Precondition: really rejected, with 401 — not 429 (lock) or 400 (form error).
      assert.equal(r.ok, false, `${was}: should have been rejected`);
      assert.equal(r.refusal.kind, 'not_signed_in', `${was}: expected not_signed_in (${r.refusal.error})`);
      assert.equal(computed.length, 1, `${was}: exactly one hash`);
      assert.equal(cost(computed[0]), cost(hash), `${was}: the same cost as a real account`);
    }
  } finally {
    await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
    // Without this the pool stays open and the test process never ends.
    await db.pool.end().catch(() => {});
  }
});
