/**
 * A QR code created a second time stays: the expiry counter of the first
 * code must not clear it away, nor must the pairing query (every 2 s).
 * Real server, real Chrome; only the lifetime of the first code is shortened to 4 s
 * (response of /qr-token rewritten) so that its counter expires in the test.
 *
 * Counter-check (measured 12.11.2026): the state of the day of zugaenge.js in which
 * generateQrCode only holds the counter locally and lets it keep running when regenerating
 * → red: „der zweite Code steht nach Ablauf des ersten nicht mehr da“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

// Without APP_BASE_URL the server refuses the code; http, so that the session cookie applies without TLS.
process.env.APP_BASE_URL = 'http://lego.example.org';

test('QR code: the second code stays after the first expires', { timeout: 180_000 }, async t => {
  const app = await startApp(t, {
    // Without admin rights no second factor, so no prompt before the code.
    holding: (db, uid) => db.run('UPDATE users SET is_admin = false WHERE id = $1', [uid]),
  });
  if (app.reason) return t.skip(app.reason);
  const { b, bis } = app;

  let erzeugt = 0;
  await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*/v2/auth/qr-token*', requestStage: 'Response' }] });
  b.listener.push(async d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const { requestId } = d.params;
    const { body, base64Encoded } = await b.tab('Fetch.getResponseBody', { requestId });
    const response = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
    if (++erzeugt === 1) response.expires_in = 4;
    await b.tab('Fetch.fulfillRequest', {
      requestId,
      responseCode: d.params.responseStatusCode,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(response)).toString('base64'),
    });
  });

  await b.auswerten(`document.querySelector('.ntab[data-tab="settings"]').click(); true`);
  await bis(`typeof document.getElementById('btn-gen-qr')?.onclick === 'function'`, 'QR-Knopf verdrahtet');
  const image = `document.querySelector('#qr-code img')?.getAttribute('src') || ''`;
  const create = () =>
    b.auswerten(`document.getElementById('qr-password').value = 'app-Passwort-1';
      document.getElementById('btn-gen-qr').click(); true`);

  await create();
  await bis(
    `(${image}).startsWith('data:image/png') && !document.getElementById('btn-gen-qr').disabled`,
    'erster Code',
  );
  const erstes = await b.auswerten(image);
  await create();
  await bis(`(${image}).startsWith('data:image/png') && (${image}) !== ${JSON.stringify(erstes)}`, 'zweiter Code');
  assert.equal(erzeugt, 2);
  // Five beats of the new counter: by then the first one's (4 s) has expired and the pairing has been asked twice.
  await bis(`/4:5[0-5]/.test(document.getElementById('qr-hint').textContent)`, 'neuer Zähler bei 4:55', 150);

  const nachher = await b.auswerten(`({ image: ${image}, hint: document.getElementById('qr-hint').textContent })`);
  assert.ok(
    nachher.image.startsWith('data:image/png'),
    'the second code is no longer shown after the first one expires',
  );
  assert.notEqual(nachher.image, erstes);
  assert.match(nachher.hint, /4:5\d/);
});
