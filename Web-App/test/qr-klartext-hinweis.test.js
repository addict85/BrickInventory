/**
 * Beim QR-Code für die App steht ein Hinweis, wenn die Serveradresse mit
 * http:// beginnt — dann geht das langlebige App-Token im WLAN lesbar mit.
 * Bei https:// steht nichts.
 *
 * Gegenprobe (am 28.10.2026 gemessen): die Zeile `klartext.hidden = …` auf
 * `true` gesetzt → rot: „http:// …“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

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

test('http:// bekommt den Klartext-Hinweis', async () => {
  const h = await hinweisFuer('http://192.168.1.5:3000');
  assert.equal(h.versteckt, false);
  assert.match(h.text, /unverschlüsselt/);
});

test('https:// bekommt keinen', async () => {
  const h = await hinweisFuer('https://lego.example.org');
  assert.equal(h.versteckt, true);
  assert.equal(h.text, '');
});
