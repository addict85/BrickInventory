/**
 * A PDF ticket applies once, only for account and target and only in the set of services
 * that issued it (no module storage).
 *
 * Counter-checks (measured 14.11.2026): the tickets again in a map of the module →
 * red: “another set of services does not know the ticket”. In redeemTicket
 * `t.bis >= k.uhr.jetzt()` → `true` → red: “after 60 s it no longer applies”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');
const { buildAndRequire, ROOT } = require('./helpers/sources');
buildAndRequire();
// The built module itself: the functions take the context explicitly.
const { issueTicket, redeemTicket } = require(path.join(ROOT, 'dist/src/vouchers/pdfTicket.js'));
const { Faecher } = require(path.join(ROOT, 'dist/src/infra/cache.js'));
const { stellbareClock } = require(path.join(ROOT, 'dist/src/infra/clock.js'));

test('PDF ticket: once, per account and target, per set of services', async t => {
  const a = { faecher: new Faecher(), uhr: stellbareClock() },
    b = { faecher: new Faecher(), uhr: stellbareClock() };
  await t.test('another set of services does not know the ticket', () => {
    assert.equal(redeemTicket(b, issueTicket(a, 7, 'export'), 7, 'export'), false);
  });
  await t.test('once, only for account and target', () => {
    const ticket = issueTicket(a, 7, '12');
    assert.equal(redeemTicket(a, ticket, 8, '12'), false, 'fremdes Konto');
    const zweites = issueTicket(a, 7, '12');
    assert.equal(redeemTicket(a, zweites, 7, '12'), true);
    assert.equal(redeemTicket(a, zweites, 7, '12'), false, 'ein zweites Mal');
  });
  await t.test('after 60 s it no longer applies (set clock instead of waiting)', () => {
    const ticket = issueTicket(a, 7, 'spaet');
    a.uhr.vor(61_000);
    assert.equal(redeemTicket(a, ticket, 7, 'spaet'), false);
  });
});
