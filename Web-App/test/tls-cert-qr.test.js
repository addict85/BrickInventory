/**
 * The settings show the root's fingerprint as a QR code for the app's certificate question:
 * the server's real /settings/tls response (tlsInfo() on a fixture CA) is fed into the page,
 * and the text handed to the QR generator must be exactly `brickinventory-cert:v1:spki-sha256:`
 * plus all 64 hex digits of the SPKI hash, computed here independently with node:crypto.
 *
 * Counter-checks (23.11.2026):
 *   A  certificateCode() in public/js/accesses.js puts only `hex.slice(0, 32)` into the code
 *      → red: “the QR code carries …”
 *   B  prefix 'brickinventory-cert:v2:…' → red: “the QR code carries …”
 *   C  the drawQr() call in loadTls() removed → red: “the QR code carries …”
 *   D  certificateCode() without the `/^[0-9a-f]{64}$/` check → red: “a broken fingerprint
 *      line …” (a shortened code is drawn)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { environment, buildAndRequire } = require('./helpers/sources');
const { openUi, view, waitFor, tick } = require('./helpers/ui');

const CA = path.join(__dirname, 'fixtures', 'ca-root-1.crt');
environment({ APP_BASE_URL: 'https://lego.test', CA_CERTIFICATE: CA });
const _req = buildAndRequire();

/** The SPKI hash without the code under test: what the app compares against. */
function expectedHex() {
  const cert = new crypto.X509Certificate(fs.readFileSync(CA));
  return crypto
    .createHash('sha256')
    .update(cert.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

/** Opens the TLS area with the server's response and returns what reached the QR generator. */
/** @param {(tls: any) => any} [change] alters the response before the page sees it */
async function qrTexts(change = tls => tls) {
  const tls = { success: true, ...(await _req('src/infra/tlsRoot.js').tlsInfo()) };
  /** @type {string[]} */
  const texts = [];
  const { w, d } = await openUi(
    { '/v2/settings/tls': change(tls), '/v2/settings/tokens': { success: true, tokens: [] } },
    {
      before: win => {
        // A class: drawQr() calls it with `new`, like the real QRCode.js.
        win.QRCode = class {
          static CorrectLevel = { M: 0 };
          /** @param {unknown} _el @param {{ text: string }} o */
          constructor(_el, o) {
            texts.push(o.text);
          }
        };
      },
    },
  );
  try {
    await view(w, 'app');
    await waitFor(() => !!d.getElementById('tls-fp-hex'));
    await tick(50);
    return { tls, texts, surface: d.getElementById('tls-surface')?.textContent || '' };
  } finally {
    w.close();
  }
}

test('the QR code carries exactly the full SPKI fingerprint of the root', async () => {
  const { tls, texts, surface } = await qrTexts();
  const hex = expectedHex();
  assert.equal(hex.length, 64);
  assert.equal(tls.fp_hex?.replace(/:/g, '').toLowerCase(), hex, 'the server reports the fixture root');
  // The settings' code is the only one drawn here; the sign-in code needs a click.
  assert.deepEqual(texts, [`brickinventory-cert:v1:spki-sha256:${hex}`]);
  assert.match(surface, /QR-Code scannen/);
});

test('a broken fingerprint line draws no half code', async () => {
  const { texts } = await qrTexts(tls => ({ ...tls, fp_hex: tls.fp_hex?.slice(0, 40) }));
  assert.deepEqual(texts, []);
});
