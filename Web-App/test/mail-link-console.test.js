/**
 * Ohne SMTP zeigt die Konsole den Link einer Mail — ohne Token, ausser mit eigenem Schalter.
 * Die Konsole landet in app_logs; ein Reset-Link darin wäre für jeden
 * Verwalter 48 Stunden lang ein Zugang zu fremden Konten.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  die Ersetzung in linkForConsole entfernt → rot: „in Produktion ohne Token"
 *   B  wieder nur bei NODE_ENV=production maskiert → rot: „ohne NODE_ENV ohne Token"
 * Gegenproben (am 29.10.2026 gemessen, Schalter statt NODE_ENV):
 *   C  die Ersetzung entfernt → rot: „ohne Schalter …“, „NODE_ENV …“ und
 *      „mit MAIL_KONSOLE_MIT_TOKEN=1 …“ (der Wert „ja“)
 *   D  wieder NODE_ENV=development/test als Ausnahme → rot: „NODE_ENV öffnet nichts“
 * Gegenprobe (13.11.2026 gemessen):
 *   E  in linkForConsole `#` aus `[?&#]token=` gestrichen → rot: „ohne
 *      Schalter ohne Token“ (der Token im Fragment stand im Klartext)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const environment = require('./helpers/sources').environment;
const { linkForConsole } = _req('src/mail/mailer.js');

// Der Absender reicht den Link selbst; aus dem Text gesucht wird nicht mehr.
const TEXT = 'https://lego.example.org/reset?token=abcdef0123456789';

test('without switch without token', () => {
  const link = linkForConsole(TEXT, undefined);
  assert.equal(link, 'https://lego.example.org/reset?token=…');
  assert.ok(!link.includes('abcdef'), link);
  assert.equal(
    linkForConsole('https://x.example/verify?a=1&token=geheim#oben', undefined),
    'https://x.example/verify?a=1&token=…#oben',
  );
  // Seit die Mails den Token ins Fragment legen (#token=).
  assert.equal(linkForConsole('https://x.example/verify#token=geheim', undefined), 'https://x.example/verify#token=…');
});

test('NODE_ENV opens nothing — not even development', () => {
  const alt = process.env.NODE_ENV;
  try {
    for (const art of ['development', 'test', 'production']) {
      environment({ NODE_ENV: art });
      assert.equal(linkForConsole(TEXT), 'https://lego.example.org/reset?token=…', art);
    }
  } finally {
    if (alt === undefined) environment({ NODE_ENV: undefined });
    else environment({ NODE_ENV: alt });
  }
});

test('with MAIL_KONSOLE_MIT_TOKEN=1 complete — then the console is the outbox', () => {
  assert.equal(linkForConsole(TEXT, '1'), 'https://lego.example.org/reset?token=abcdef0123456789');
  assert.equal(linkForConsole(TEXT, 'ja'), 'https://lego.example.org/reset?token=…', 'nur „1" schaltet');
});

test('without a link nothing — not even one from running text', () => {
  assert.equal(linkForConsole('nur Text', undefined), null);
  assert.equal(linkForConsole('Hallo https://boese.example/x', '1'), null);
  assert.equal(linkForConsole(undefined, '1'), null);
});
