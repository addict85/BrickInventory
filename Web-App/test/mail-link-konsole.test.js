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
 * Gegenprobe (13.11.2026 gemessen):
 *   E  in linkFuerKonsole `#` aus `[?&#]token=` gestrichen → rot: „ohne
 *      Schalter ohne Token“ (der Token im Fragment stand im Klartext)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const umgebung = require('./helpers/sources').umgebung;
const { linkFuerKonsole } = _req('src/mail/mailer.js');

// Der Absender reicht den Link selbst; aus dem Text gesucht wird nicht mehr.
const TEXT = 'https://lego.example.org/reset?token=abcdef0123456789';

test('ohne Schalter ohne Token', () => {
  const link = linkFuerKonsole(TEXT, undefined);
  assert.equal(link, 'https://lego.example.org/reset?token=…');
  assert.ok(!link.includes('abcdef'), link);
  assert.equal(
    linkFuerKonsole('https://x.example/verify?a=1&token=geheim#oben', undefined),
    'https://x.example/verify?a=1&token=…#oben',
  );
  // Seit die Mails den Token ins Fragment legen (#token=).
  assert.equal(linkFuerKonsole('https://x.example/verify#token=geheim', undefined), 'https://x.example/verify#token=…');
});

test('NODE_ENV öffnet nichts — auch nicht development', () => {
  const alt = process.env.NODE_ENV;
  try {
    for (const art of ['development', 'test', 'production']) {
      umgebung({ NODE_ENV: art });
      assert.equal(linkFuerKonsole(TEXT), 'https://lego.example.org/reset?token=…', art);
    }
  } finally {
    if (alt === undefined) umgebung({ NODE_ENV: undefined });
    else umgebung({ NODE_ENV: alt });
  }
});

test('mit MAIL_KONSOLE_MIT_TOKEN=1 vollständig — dann ist die Konsole der Postausgang', () => {
  assert.equal(linkFuerKonsole(TEXT, '1'), 'https://lego.example.org/reset?token=abcdef0123456789');
  assert.equal(linkFuerKonsole(TEXT, 'ja'), 'https://lego.example.org/reset?token=…', 'nur „1" schaltet');
});

test('ohne Link nichts — auch keiner aus Fliesstext', () => {
  assert.equal(linkFuerKonsole('nur Text', undefined), null);
  assert.equal(linkFuerKonsole('Hallo https://boese.example/x', '1'), null);
  assert.equal(linkFuerKonsole(undefined, '1'), null);
});
