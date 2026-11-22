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
const { ROOT, ohneKommentare, checkParameter } = require('./helpers/sources');

const lies = rel => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

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
      lies('src/account/loginCheck.ts'),
      'verifyEmailToken',
      ['token'],
      'die gemeinsame Verifikationslogik',
    );
  });

  await t.test('the verification query appears exactly once in the tree', () => {
    const treffer = CANDIDATES.filter(rel => QUERY.test(lies(rel)));
    assert.deepEqual(
      treffer,
      ['src/account/repository/accounts.ts'],
      'Die Abfrage nach email_neu_token gehört ausschliesslich in ' +
        'adoptEmailNew(). Gefunden in: ' +
        treffer.join(', ') +
        ' — damit ist die Doppelung aus einer früheren Runde zurück.',
    );
  });

  await t.test('redeeming (email_verified=true) appears exactly once in the tree', () => {
    const treffer = CANDIDATES.filter(rel => REDEEM.test(lies(rel)));
    assert.deepEqual(
      treffer,
      ['src/account/repository/accounts.ts'],
      'Auch das Setzen von email_verified gehört nur an eine Stelle. ' + 'Gefunden in: ' + treffer.join(', '),
    );
  });

  await t.test('the one remaining path calls the shared function', () => {
    // The only path is POST /api/v1/auth/email-bestaetigen (the button on the
    // page behind the mail link). GET /verify in server.ts only delivers the
    // page; if it redeemed by itself again, a link scanner would already confirm.
    // The behavior is checked by sicherheit-server-grenzen-db on the real server.
    assert.match(
      lies('routes/auth/registration.ts'),
      /verifyEmailToken\s*\(/,
      'routes/auth/registration.ts löst den Token nicht über die gemeinsame Funktion ein',
    );
    assert.doesNotMatch(
      lies('server.ts'),
      /verifyEmailToken\s*\(/,
      'server.ts löst wieder selbst Token ein — der Link allein bestätigte dann',
    );
  });

  // “the API path does NOT answer with a redirect" has been dropped
});
