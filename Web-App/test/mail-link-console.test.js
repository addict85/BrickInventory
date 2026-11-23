/**
 * Without SMTP the console shows the link of a mail — without token, except with an own switch.
 * The console ends up in app_logs; a reset link in it would be for every
 * admin an access to foreign accounts for 48 hours.
 *
 * Counter-checks (measured on 27.10.):
 *   A  the replacement in linkForConsole removed → red: „in Produktion ohne Token"
 *   B  masked again only with NODE_ENV=production → red: „ohne NODE_ENV ohne Token"
 * Counter-checks (measured on 29.10.2026, switch instead of NODE_ENV):
 *   C  the replacement removed → red: “without switch …”, “NODE_ENV …” and
 *      “with MAIL_CONSOLE_WITH_TOKEN=1 …” (the value „ja“)
 *   D  again NODE_ENV=development/test as an exception → red: “NODE_ENV opens nothing”
 * Counter-check (measured 13.11.2026):
 *   E  in linkForConsole `#` deleted from `[?&#]token=` → red: “without
 *      switch without token” (the token in the fragment stood in plaintext)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const environment = require('./helpers/sources').environment;
const { linkForConsole } = _req('src/mail/mailer.js');

// The sender passes the link itself; it is no longer searched for in the text.
const TEXT = 'https://lego.example.org/reset?token=abcdef0123456789';

test('without switch without token', () => {
  const link = linkForConsole(TEXT, undefined);
  assert.equal(link, 'https://lego.example.org/reset?token=…');
  assert.ok(!link.includes('abcdef'), link);
  assert.equal(
    linkForConsole('https://x.example/verify?a=1&token=geheim#oben', undefined),
    'https://x.example/verify?a=1&token=…#oben',
  );
  // Since the mails put the token into the fragment (#token=).
  assert.equal(linkForConsole('https://x.example/verify#token=geheim', undefined), 'https://x.example/verify#token=…');
});

test('NODE_ENV opens nothing — not even development', () => {
  const alt = process.env.NODE_ENV;
  try {
    for (const kind of ['development', 'test', 'production']) {
      environment({ NODE_ENV: kind });
      assert.equal(linkForConsole(TEXT), 'https://lego.example.org/reset?token=…', kind);
    }
  } finally {
    if (alt === undefined) environment({ NODE_ENV: undefined });
    else environment({ NODE_ENV: alt });
  }
});

test('with MAIL_CONSOLE_WITH_TOKEN=1 complete — then the console is the outbox', () => {
  assert.equal(linkForConsole(TEXT, '1'), 'https://lego.example.org/reset?token=abcdef0123456789');
  assert.equal(linkForConsole(TEXT, 'ja'), 'https://lego.example.org/reset?token=…', 'nur „1" schaltet');
});

test('without a link nothing — not even one from running text', () => {
  assert.equal(linkForConsole('nur Text', undefined), null);
  assert.equal(linkForConsole('Hallo https://boese.example/x', '1'), null);
  assert.equal(linkForConsole(undefined, '1'), null);
});
