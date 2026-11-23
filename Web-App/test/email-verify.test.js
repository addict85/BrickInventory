/**
 * E-mail verification only exists in ONE place.
 *
 * ── Counter-check (measured 04.11.2026) ─────────────────────────────────────
 * The query from adoptEmailNew() additionally as its own function in
 * src/account/repository/accesses.ts → red: “the verification query stands exactly
 * once in the tree" (names both locations).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, withoutComments, checkParameter } = require('./helpers/sources');

const read = rel => withoutComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// The query that REDEEMS the token: registration and new address both carry
// it in new_email_token since round 13 (verification_token is empty).
const QUERY = /new_email_token\s*=\s*\$1\s+AND\s+new_email_until\s*>\s*NOW\(\)/;
const REDEEM = /email_verified\s*=\s*true/i;
const CANDIDATES = [
  'src/account/loginCheck.ts',
  'src/account/repository/accesses.ts',
  'src/account/repository/accounts.ts',
  'server.ts',
  'routes/auth.ts',
  'routes/auth/registration.ts',
];

test('email verification only lives in one place', async t => {
  await t.test('verifyEmailToken accepts the raw token', () => {
    // checkParameter instead of a pattern over the whole header: adding a
    // type annotation is an improvement and must not knock over a
    // test.
    checkParameter(
      read('src/account/loginCheck.ts'),
      'verifyEmailToken',
      ['token'],
      'die gemeinsame Verifikationslogik',
    );
  });

  await t.test('the verification query appears exactly once in the tree', () => {
    const hits = CANDIDATES.filter(rel => QUERY.test(read(rel)));
    assert.deepEqual(
      hits,
      ['src/account/repository/accounts.ts'],
      `The query for email_neu_token belongs exclusively in adoptEmailNew(). Found in: ${hits.join(', ')} — so the duplication from an earlier round is back.`,
    );
  });

  await t.test('redeeming (email_verified=true) appears exactly once in the tree', () => {
    const hits = CANDIDATES.filter(rel => REDEEM.test(read(rel)));
    assert.deepEqual(
      hits,
      ['src/account/repository/accounts.ts'],
      `Setting email_verified also belongs in one place only. Found in: ${hits.join(', ')}`,
    );
  });

  await t.test('the one remaining path calls the shared function', () => {
    // The only path is POST /api/v2/auth/email-bestaetigen (the button on the
    // page behind the mail link). GET /verify in server.ts only delivers the
    // page; if it redeemed by itself again, a link scanner would already confirm.
    // The behavior is checked by sicherheit-server-grenzen-db on the real server.
    assert.match(
      read('routes/auth/registration.ts'),
      /verifyEmailToken\s*\(/,
      'routes/auth/registration.ts does not redeem the token through the shared function',
    );
    assert.doesNotMatch(
      read('server.ts'),
      /verifyEmailToken\s*\(/,
      'server.ts redeems tokens itself again — the link alone would then confirm',
    );
  });

  // “the API path does NOT answer with a redirect" has been dropped
});
