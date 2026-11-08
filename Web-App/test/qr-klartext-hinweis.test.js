/**
 * Beim QR-Code für die App steht ein Hinweis, wenn die Serveradresse mit
 * http:// beginnt — die Android-App nimmt nur noch HTTPS an. Bei https://
 * steht nichts. Die TLS-Fläche der Einstellungen sagt dasselbe ohne HTTPS.
 *
 * Gegenproben:
 *   A  (28.10.2026) die Zeile `klartext.hidden = …` auf `true` gesetzt → rot:
 *      „http:// …“
 *   B  (01.11.2026) qr.klartext_hinweis und tls.ohne_https auf dem alten Text
 *      („… geht unverschlüsselt mit“) → rot: „http:// …“ und „ohne HTTPS …“
 *   C  (08.11.2026) in 05-settings.js wieder `let secs = 1800` → rot: „der
 *      Countdown zählt von der Dauer des Servers“; settings.qr.hint in de.js
 *      wieder mit „30 Minuten“ → rot: dort (Hinweis nennt nicht 5 Minuten).
 *      Dass der Server 300 Sekunden nennt, prüft anmeldung-regeln-db.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, sicht, warte } = require('./helpers/oberflaeche');

async function hinweisFuer(url) {
  const o = await oeffneOberflaeche({
    '/v1/auth/qr-token': { success: true, url, token: 'abc', expires_in: 300, token_days: null },
  });
  try {
    o.d.getElementById('btn-gen-qr').click();
    await warte(() => o.d.getElementById('qr-code').textContent.includes('abc'));
    const el = o.d.getElementById('qr-tls-hint');
    return { versteckt: el.hidden, text: el.textContent };
  } finally { o.w.close(); }
}

test('http:// bekommt den Hinweis, dass die App nur HTTPS annimmt', async () => {
  const h = await hinweisFuer('http://192.168.1.5:3000');
  assert.equal(h.versteckt, false);
  assert.match(h.text, /Android-App nimmt nur noch HTTPS an/);
});

test('https:// bekommt keinen', async () => {
  const h = await hinweisFuer('https://lego.example.org');
  assert.equal(h.versteckt, true);
  assert.equal(h.text, '');
});

test('ohne HTTPS nennt die TLS-Fläche, dass die App sich nur über HTTPS verbindet', async () => {
  const { w, d } = await oeffneOberflaeche({ '/v1/settings/tls': { success: true, https: false, fp: null },
    '/v1/settings/tokens': { success: true, tokens: [] } });
  try {
    await sicht(w, 'app');
    await warte(() => /HTTPS/.test(d.getElementById('tls-flaeche')?.textContent || ''));
    assert.match(d.getElementById('tls-flaeche').textContent, /Android-App verbindet sich nur über HTTPS/);
  } finally { w.close(); }
});

test('der Countdown zählt von der Dauer des Servers, der Hinweis nennt dieselbe', async () => {
  for (const [sprache, minuten] of [['de', /5 Minuten gültig/], ['en', /valid for 5 minutes/]]) {
    const { w, d } = await oeffneOberflaeche({
      '/v1/auth/qr-token': { success: true, url: 'https://lego.example.org', token: 'abc', expires_in: 300, token_days: null },
    }, { sprache });
    try {
      assert.match(d.querySelector('[data-i18n="settings.qr.hint"]').textContent, minuten);
      d.getElementById('btn-gen-qr').click();
      await warte(() => d.getElementById('qr-code').textContent.includes('abc'));
      assert.match(d.getElementById('qr-hint').textContent, /\b5:00\b/, 'Der Zähler beginnt nicht bei der Dauer des Servers');
    } finally { w.close(); }
  }
});
