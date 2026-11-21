/**
 * After the scan the web UI asks „Gerät X koppeln?“ and sends the
 * code that the app shows; only afterwards does it report the device as paired.
 * Rejecting sends the rejection and clears the QR code away.
 *
 * Counter-checks (measured 09.11.2026, each on its own):
 *   A  in generateQrCode() (einstellungen.js) the line `_kopplung = { … }`
 *      deleted → red: both cases (the question never appears)
 *   B  in qrKopplungBestaetigen() `{ code: '' }` instead of the field → red:
 *      “the question names the device …” (wrong code to the server)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

/** @param {string} endStand  what the server reports after the button */
async function kopplung(knopf, endStand) {
  let stand = 'offen';
  const gesendet = [];
  const o = await openUi({
    '/v1/auth/qr-token': {
      success: true,
      url: 'https://lego.example.org',
      token: 'bim:abc',
      kopplung: 7,
      expires_in: 300,
      token_days: null,
    },
    '/v1/auth/qr-kopplung/7': () => ({ success: true, stand, geraet: 'Pixel 9', ip_range: '10.0.0.0/24' }),
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

test("the question names the device, confirming sends the app's code", async () => {
  const k = await kopplung('qrKopplungBestaetigen', 'abgeholt');
  assert.match(k.frage, /„Pixel 9“ \(Netz 10\.0\.0\.0\/24\) möchte sich koppeln/);
  assert.deepEqual(k.gesendet, [['ja', { code: '123 456' }]]);
  assert.match(k.ende, /ist gekoppelt/);
});

test('rejecting sends the rejection and clears the QR code', async () => {
  const k = await kopplung('qrKopplungAblehnen', 'abgelehnt');
  assert.deepEqual(k.gesendet, [['nein']]);
  assert.match(k.ende, /abgelehnt/);
  assert.equal(k.qr, '');
});
