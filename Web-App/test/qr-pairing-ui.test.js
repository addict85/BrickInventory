/**
 * After the scan the web UI asks „Gerät X koppeln?“ and sends the
 * code that the app shows; only afterwards does it report the device as paired.
 * Rejecting sends the rejection and clears the QR code away.
 *
 * Counter-checks (measured 09.11.2026, each on its own):
 *   A  in generateQrCode() (einstellungen.js) the line `_kopplung = { … }`
 *      deleted → red: both cases (the question never appears)
 *   B  in confirmQrPairing() `{ code: '' }` instead of the field → red:
 *      “the question names the device …” (wrong code to the server)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

/** @param {string} endStatus  what the server reports after the button */
async function pairing(knopf, endStatus) {
  let state = 'offen';
  const gesendet = [];
  const o = await openUi({
    '/v2/auth/qr-token': {
      success: true,
      url: 'https://lego.example.org',
      token: 'bim:abc',
      pairing: 7,
      expires_in: 300,
      token_days: null,
    },
    '/v2/auth/qr-pairing/7': () => ({ success: true, state, device: 'Pixel 9', ip_range: '10.0.0.0/24' }),
    '/v2/auth/qr-pairing/7/confirm': (_u, init) => {
      gesendet.push(['ja', JSON.parse(init.body)]);
      state = endStatus;
      return { success: true };
    },
    '/v2/settings/tokens': { success: true, tokens: [] },
    '/v2/auth/qr-pairing/7/reject': () => {
      gesendet.push(['nein']);
      state = endStatus;
      return { success: true };
    },
  });
  const d = o.d;
  try {
    d.getElementById('btn-gen-qr').click();
    await warte(() => d.getElementById('qr-code').textContent.includes('bim:abc'));
    state = 'wartet';
    await warte(() => !d.getElementById('qr-pairing').hidden, 6000);
    const frage = d.getElementById('qr-pairing-text').textContent;
    d.getElementById('qr-pairing-code').value = '123 456';
    d.querySelector(`[data-click="${knopf}"]`).click();
    await warte(() => gesendet.length && d.getElementById('qr-pairing-field').hidden, 6000);
    return {
      frage,
      gesendet,
      ende: d.getElementById('qr-pairing-text').textContent,
      qr: d.getElementById('qr-code').textContent,
    };
  } finally {
    o.w.close();
  }
}

test("the question names the device, confirming sends the app's code", async () => {
  const k = await pairing('confirmQrPairing', 'abgeholt');
  assert.match(k.frage, /„Pixel 9“ \(Netz 10\.0\.0\.0\/24\) möchte sich koppeln/);
  assert.deepEqual(k.gesendet, [['ja', { code: '123 456' }]]);
  assert.match(k.ende, /ist gekoppelt/);
});

test('rejecting sends the rejection and clears the QR code', async () => {
  const k = await pairing('rejectQrPairing', 'abgelehnt');
  assert.deepEqual(k.gesendet, [['nein']]);
  assert.match(k.ende, /abgelehnt/);
  assert.equal(k.qr, '');
});
