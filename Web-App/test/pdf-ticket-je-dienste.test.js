/**
 * Ein PDF-Ticket gilt einmal, nur für Konto und Ziel und nur in dem Satz Dienste,
 * der es ausgestellt hat (kein Speicher des Moduls).
 *
 * Gegenprobe (14.11.2026 gemessen): die Tickets wieder in einer Map des Moduls →
 * rot: „ein anderer Satz Dienste kennt das Ticket nicht“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');
const { buildAndRequire, ROOT } = require('./helpers/sources');
buildAndRequire();
// Das gebaute Modul selbst: Die Funktionen nehmen den Kontext ausdrücklich.
const { stelleTicketAus, loeseTicketEin } = require(path.join(ROOT, 'dist/src/gutscheine/pdfTicket.js'));
const { Faecher } = require(path.join(ROOT, 'dist/src/infra/zwischenspeicher.js'));

test('PDF-Ticket: einmal, je Konto und Ziel, je Satz Dienste', async t => {
  const a = { faecher: new Faecher() },
    b = { faecher: new Faecher() };
  await t.test('ein anderer Satz Dienste kennt das Ticket nicht', () => {
    assert.equal(loeseTicketEin(b, stelleTicketAus(a, 7, 'export'), 7, 'export'), false);
  });
  await t.test('einmal, nur für Konto und Ziel', () => {
    const ticket = stelleTicketAus(a, 7, '12');
    assert.equal(loeseTicketEin(a, ticket, 8, '12'), false, 'fremdes Konto');
    const zweites = stelleTicketAus(a, 7, '12');
    assert.equal(loeseTicketEin(a, zweites, 7, '12'), true);
    assert.equal(loeseTicketEin(a, zweites, 7, '12'), false, 'ein zweites Mal');
  });
});
