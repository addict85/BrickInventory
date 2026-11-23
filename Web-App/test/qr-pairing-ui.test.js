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
const { openUi, waitFor } = require('./helpers/ui');

/** @param {string} endStatus  what the server reports after the button */
async function pairing(button, endStatus) {
  let state = 'open';
  const sent = [];
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
      sent.push(['ja', JSON.parse(init.body)]);
      state = endStatus;
      return { success: true };
    },
    '/v2/settings/tokens': { success: true, tokens: [] },
    '/v2/auth/qr-pairing/7/reject': () => {
      sent.push(['nein']);
      state = endStatus;
      return { success: true };
    },
  });
  const d = o.d;
  try {
    d.getElementById('btn-gen-qr').click();
    await waitFor(() => d.getElementById('qr-code').textContent.includes('bim:abc'));
    state = 'waiting';
    await waitFor(() => !d.getElementById('qr-pairing').hidden, 6000);
    const question = d.getElementById('qr-pairing-text').textContent;
    d.getElementById('qr-pairing-code').value = '123 456';
    d.querySelector(`[data-click="${button}"]`).click();
    await waitFor(() => sent.length && d.getElementById('qr-pairing-field').hidden, 6000);
    return {
      question,
      sent,
      end: d.getElementById('qr-pairing-text').textContent,
      qr: d.getElementById('qr-code').textContent,
    };
  } finally {
    o.w.close();
  }
}

test("the question names the device, confirming sends the app's code", async () => {
  const k = await pairing('confirmQrPairing', 'collected');
  assert.match(k.question, /„Pixel 9“ \(Netz 10\.0\.0\.0\/24\) möchte sich koppeln/);
  assert.deepEqual(k.sent, [['ja', { code: '123 456' }]]);
  assert.match(k.end, /ist gekoppelt/);
});

test('rejecting sends the rejection and clears the QR code', async () => {
  const k = await pairing('rejectQrPairing', 'rejected');
  assert.deepEqual(k.sent, [['nein']]);
  assert.match(k.end, /abgelehnt/);
  assert.equal(k.qr, '');
});
