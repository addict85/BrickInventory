/**
 * Ein PDF-Ticket gilt einmal, nur für Konto und Ziel und nur in dem Satz Dienste,
 * der es ausgestellt hat (kein Speicher des Moduls).
 *
 * Gegenproben (14.11.2026 gemessen): die Tickets wieder in einer Map des Moduls →
 * rot: „ein anderer Satz Dienste kennt das Ticket nicht“. In redeemTicket
 * `t.bis >= k.uhr.jetzt()` → `true` → rot: „nach 60 s gilt es nicht mehr“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');
const { buildAndRequire, ROOT } = require('./helpers/sources');
buildAndRequire();
// Das gebaute Modul selbst: Die Funktionen nehmen den Kontext ausdrücklich.
const { issueTicket, redeemTicket } = require(path.join(ROOT, 'dist/src/vouchers/pdfTicket.js'));
const { Faecher } = require(path.join(ROOT, 'dist/src/infra/cache.js'));
const { stellbareClock } = require(path.join(ROOT, 'dist/src/infra/clock.js'));

test('PDF-Ticket: einmal, je Konto und Ziel, je Satz Dienste', async t => {
  const a = { faecher: new Faecher(), uhr: stellbareClock() },
    b = { faecher: new Faecher(), uhr: stellbareClock() };
  await t.test('ein anderer Satz Dienste kennt das Ticket nicht', () => {
    assert.equal(redeemTicket(b, issueTicket(a, 7, 'export'), 7, 'export'), false);
  });
  await t.test('einmal, nur für Konto und Ziel', () => {
    const ticket = issueTicket(a, 7, '12');
    assert.equal(redeemTicket(a, ticket, 8, '12'), false, 'fremdes Konto');
    const zweites = issueTicket(a, 7, '12');
    assert.equal(redeemTicket(a, zweites, 7, '12'), true);
    assert.equal(redeemTicket(a, zweites, 7, '12'), false, 'ein zweites Mal');
  });
  await t.test('nach 60 s gilt es nicht mehr (gestellte Uhr statt Warten)', () => {
    const ticket = issueTicket(a, 7, 'spaet');
    a.uhr.vor(61_000);
    assert.equal(redeemTicket(a, ticket, 7, 'spaet'), false);
  });
});
