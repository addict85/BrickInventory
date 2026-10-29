/**
 * Ohne SMTP zeigt die Konsole den Link einer Mail — ohne Token, ausser mit eigenem Schalter.
 * Die Konsole landet in app_logs; ein Reset-Link darin wäre für jeden
 * Verwalter 48 Stunden lang ein Zugang zu fremden Konten.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  die Ersetzung in linkFuerKonsole entfernt → rot: „in Produktion ohne Token"
 *   B  wieder nur bei NODE_ENV=production maskiert → rot: „ohne NODE_ENV ohne Token"
 * Gegenproben (am 29.10.2026 gemessen, Schalter statt NODE_ENV):
 *   C  die Ersetzung entfernt → rot: „ohne Schalter …“, „NODE_ENV …“ und
 *      „mit MAIL_KONSOLE_MIT_TOKEN=1 …“ (der Wert „ja“)
 *   D  wieder NODE_ENV=development/test als Ausnahme → rot: „NODE_ENV öffnet nichts“
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { linkFuerKonsole } = _req('utils/mailer.js');

const TEXT = 'Hallo,\n\nhier zurücksetzen:\nhttps://lego.example.org/reset?token=abcdef0123456789\n\nGruss';

test('ohne Schalter ohne Token', () => {
  const link = linkFuerKonsole(TEXT, undefined);
  assert.equal(link, 'https://lego.example.org/reset?token=…');
  assert.ok(!link.includes('abcdef'), link);
  assert.equal(linkFuerKonsole('https://x.example/verify?a=1&token=geheim#oben', undefined),
    'https://x.example/verify?a=1&token=…#oben');
});

test('NODE_ENV öffnet nichts — auch nicht development', () => {
  const alt = process.env.NODE_ENV;
  try {
    for (const umgebung of ['development', 'test', 'production']) {
      process.env.NODE_ENV = umgebung;
      assert.equal(linkFuerKonsole(TEXT), 'https://lego.example.org/reset?token=…', umgebung);
    }
  } finally { if (alt === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = alt; }
});

test('mit MAIL_KONSOLE_MIT_TOKEN=1 vollständig — dann ist die Konsole der Postausgang', () => {
  assert.equal(linkFuerKonsole(TEXT, '1'), 'https://lego.example.org/reset?token=abcdef0123456789');
  assert.equal(linkFuerKonsole(TEXT, 'ja'), 'https://lego.example.org/reset?token=…', 'nur „1" schaltet');
});

test('ohne Link nichts', () => {
  assert.equal(linkFuerKonsole('nur Text', undefined), null);
  assert.equal(linkFuerKonsole(undefined, '1'), null);
});
