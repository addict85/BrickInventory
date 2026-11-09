/**
 * Nach dem Scan fragt die Web-Oberfläche „Gerät X koppeln?“ und schickt den
 * Code, den die App zeigt; erst danach meldet sie das Gerät als gekoppelt.
 * Ablehnen schickt die Ablehnung und räumt den QR-Code weg.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in generateQrCode() (05-settings.js) die Zeile `_kopplung = { … }`
 *      gestrichen → rot: beide Fälle (die Frage erscheint nie)
 *   B  in qrKopplungBestaetigen() `{ code: '' }` statt des Felds → rot:
 *      „die Frage nennt das Gerät …“ (falscher Code an den Server)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

/** @param {string} endStand  was der Server nach dem Knopf meldet */
async function kopplung(knopf, endStand) {
  let stand = 'offen';
  const gesendet = [];
  const o = await oeffneOberflaeche({
    '/v1/auth/qr-token': {
      success: true,
      url: 'https://lego.example.org',
      token: 'bim:abc',
      kopplung: 7,
      expires_in: 300,
      token_days: null,
    },
    '/v1/auth/qr-kopplung/7': () => ({ success: true, stand, geraet: 'Pixel 9', ip_bereich: '10.0.0.0/24' }),
    '/v1/auth/qr-kopplung/7/bestaetigen': (_u, init) => {
      gesendet.push(['ja', JSON.parse(init.body)]);
      stand = endStand;
      return { success: true };
    },
    '/v1/settings/tokens': { success: true, tokens: [] },
    '/v1/auth/qr-kopplung/7/ablehnen': () => {
      gesendet.push(['nein']);
      stand = endStand;
      return { success: true };
    },
  });
  const d = o.d;
  try {
    d.getElementById('btn-gen-qr').click();
    await warte(() => d.getElementById('qr-code').textContent.includes('bim:abc'));
    stand = 'wartet';
    await warte(() => !d.getElementById('qr-kopplung').hidden, 6000);
    const frage = d.getElementById('qr-kopplung-text').textContent;
    d.getElementById('qr-kopplung-code').value = '123 456';
    d.querySelector(`[data-click="${knopf}"]`).click();
    await warte(() => gesendet.length && d.getElementById('qr-kopplung-feld').hidden, 6000);
    return {
      frage,
      gesendet,
      ende: d.getElementById('qr-kopplung-text').textContent,
      qr: d.getElementById('qr-code').textContent,
    };
  } finally {
    o.w.close();
  }
}

test('die Frage nennt das Gerät, Bestätigen schickt den Code der App', async () => {
  const k = await kopplung('qrKopplungBestaetigen', 'abgeholt');
  assert.match(k.frage, /„Pixel 9“ \(Netz 10\.0\.0\.0\/24\) möchte sich koppeln/);
  assert.deepEqual(k.gesendet, [['ja', { code: '123 456' }]]);
  assert.match(k.ende, /ist gekoppelt/);
});

test('Ablehnen schickt die Ablehnung und räumt den QR-Code weg', async () => {
  const k = await kopplung('qrKopplungAblehnen', 'abgelehnt');
  assert.deepEqual(k.gesendet, [['nein']]);
  assert.match(k.ende, /abgelehnt/);
  assert.equal(k.qr, '');
});
