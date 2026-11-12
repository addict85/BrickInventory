/**
 * Ein zweites Mal erzeugter QR-Code bleibt stehen: Der Ablaufzähler des ersten
 * Codes darf ihn nicht wegräumen, die Kopplungsabfrage (alle 2 s) auch nicht.
 * Echter Server, echtes Chrome; nur die Laufzeit des ersten Codes ist auf 4 s
 * gekürzt (Antwort von /qr-token umgeschrieben), damit sein Zähler im Test abläuft.
 *
 * Gegenprobe (12.11.2026 gemessen): heutiger Stand von zugaenge.js, in dem
 * generateQrCode den Zähler nur lokal hält und beim Neuerzeugen weiterlaufen
 * lässt → rot: „der zweite Code steht nach Ablauf des ersten nicht mehr da“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

// Ohne APP_BASE_URL verweigert der Server den Code; http, damit das Sitzungs-Cookie ohne TLS gilt.
process.env.APP_BASE_URL = 'http://lego.example.org';

test('QR-Code: der zweite Code bleibt nach Ablauf des ersten stehen', { timeout: 180_000 }, async t => {
  const app = await starteApp(t, {
    // Ohne Verwalterrechte kein zweiter Faktor, also keine Rückfrage vor dem Code.
    bestand: (db, uid) => db.run('UPDATE users SET is_admin = false WHERE id = $1', [uid]),
  });
  if (app.grund) return t.skip(app.grund);
  const { b, bis } = app;

  let erzeugt = 0;
  await b.tab('Fetch.enable', { patterns: [{ urlPattern: '*/v1/auth/qr-token*', requestStage: 'Response' }] });
  b.hoerer.push(async d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const { requestId } = d.params;
    const { body, base64Encoded } = await b.tab('Fetch.getResponseBody', { requestId });
    const antwort = JSON.parse(base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
    if (++erzeugt === 1) antwort.expires_in = 4;
    await b.tab('Fetch.fulfillRequest', {
      requestId,
      responseCode: d.params.responseStatusCode,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(antwort)).toString('base64'),
    });
  });

  await b.auswerten(`document.querySelector('.ntab[data-tab="settings"]').click(); true`);
  await bis(`typeof document.getElementById('btn-gen-qr')?.onclick === 'function'`, 'QR-Knopf verdrahtet');
  const bild = `document.querySelector('#qr-code img')?.getAttribute('src') || ''`;
  const erzeuge = () =>
    b.auswerten(`document.getElementById('qr-password').value = 'app-Passwort-1';
      document.getElementById('btn-gen-qr').click(); true`);

  await erzeuge();
  await bis(`(${bild}).startsWith('data:image/png') && !document.getElementById('btn-gen-qr').disabled`, 'erster Code');
  const erstes = await b.auswerten(bild);
  await erzeuge();
  await bis(`(${bild}).startsWith('data:image/png') && (${bild}) !== ${JSON.stringify(erstes)}`, 'zweiter Code');
  assert.equal(erzeugt, 2);
  // Fünf Takte des neuen Zählers: Bis dahin ist der des ersten (4 s) abgelaufen und die Kopplung zweimal gefragt.
  await bis(`/4:5[0-5]/.test(document.getElementById('qr-hint').textContent)`, 'neuer Zähler bei 4:55', 150);

  const nachher = await b.auswerten(`({ bild: ${bild}, hinweis: document.getElementById('qr-hint').textContent })`);
  assert.ok(nachher.bild.startsWith('data:image/png'), 'der zweite Code steht nach Ablauf des ersten nicht mehr da');
  assert.notEqual(nachher.bild, erstes);
  assert.match(nachher.hinweis, /4:5\d/);
});
