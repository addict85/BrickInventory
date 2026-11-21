/**
 * Next to the QR code for the app a hint stands when the server address begins with
 * http:// — the Android app only accepts HTTPS any more. With https://
 * nothing stands there. The TLS area of the settings says the same without HTTPS.
 *
 * Counter-checks:
 *   A  (28.10.2026) the line `klartext.hidden = …` set to `true` → red:
 *      “http:// …”
 *   B  (01.11.2026) qr.klartext_hinweis and tls.ohne_https at the old text
 *      („… geht unverschlüsselt mit“) → red: “http:// …” and “without HTTPS …”
 *   C  (08.11.2026) in einstellungen.js again `let secs = 1800` → red: “the
 *      countdown counts from the server's duration”; settings.qr.hint in de.js
 *      again with „30 Minuten“ → red: there (hint does not name 5 minutes).
 *      That the server names 300 seconds is checked by login-rules-db.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, sicht, warte } = require('./helpers/ui');

async function hintFor(url) {
  const o = await openUi({
    '/v1/auth/qr-token': { success: true, url, token: 'abc', expires_in: 300, token_days: null },
  });
  try {
    o.d.getElementById('btn-gen-qr').click();
    await warte(() => o.d.getElementById('qr-code').textContent.includes('abc'));
    const el = o.d.getElementById('qr-tls-hint');
    return { versteckt: el.hidden, text: el.textContent };
  } finally {
    o.w.close();
  }
}

test('http:// gets the hint that the app only accepts HTTPS', async () => {
  const h = await hintFor('http://192.168.1.5:3000');
  assert.equal(h.versteckt, false);
  assert.match(h.text, /Android-App nimmt nur noch HTTPS an/);
});

test('https:// gets none', async () => {
  const h = await hintFor('https://lego.example.org');
  assert.equal(h.versteckt, true);
  assert.equal(h.text, '');
});

test('without HTTPS the TLS area says that the app only connects via HTTPS', async () => {
  const { w, d } = await openUi({
    '/v1/settings/tls': { success: true, https: false, fp: null },
    '/v1/settings/tokens': { success: true, tokens: [] },
  });
  try {
    await sicht(w, 'app');
    await warte(() => /HTTPS/.test(d.getElementById('tls-flaeche')?.textContent || ''));
    assert.match(d.getElementById('tls-flaeche').textContent, /Android-App verbindet sich nur über HTTPS/);
  } finally {
    w.close();
  }
});

test("the countdown counts from the server's duration, the hint names the same", async () => {
  for (const [sprache, minuten] of /** @type {[string, RegExp][]} */ ([
    ['de', /5 Minuten gültig/],
    ['en', /valid for 5 minutes/],
  ])) {
    const { w, d } = await openUi(
      {
        '/v1/auth/qr-token': {
          success: true,
          url: 'https://lego.example.org',
          token: 'abc',
          expires_in: 300,
          token_days: null,
        },
      },
      { sprache },
    );
    try {
      assert.match(d.querySelector('[data-i18n="settings.qr.hint"]').textContent, minuten);
      d.getElementById('btn-gen-qr').click();
      await warte(() => d.getElementById('qr-code').textContent.includes('abc'));
      assert.match(
        d.getElementById('qr-hint').textContent,
        /\b5:00\b/,
        'Der Zähler beginnt nicht bei der Dauer des Servers',
      );
    } finally {
      w.close();
    }
  }
});
