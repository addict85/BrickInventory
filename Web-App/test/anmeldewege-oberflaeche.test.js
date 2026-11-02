/**
 * Die Anmeldemaske bietet nur Wege an, die der Server kann: ohne Passkey-
 * Adresse kein Passkey-Knopf, ohne Mailversand kein „Passwort vergessen?“.
 * Fehlt die Angabe (älterer Server), bleibt alles wie bisher. Die Maske ist
 * ein <main>, damit Vorleser dort einen Hauptbereich finden.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  in checkRegistrationEnabled() die beiden neuen Zeilen entfernt → rot:
 *      „der Server kann beides nicht“ (Passkey-Knopf und Link sichtbar)
 *   B  Link auch ohne Angabe verborgen (hidden = !d.passwort_vergessen) → rot:
 *      „älterer Server ohne Angabe“
 *   C  #login-screen wieder <div> → alle drei rot (kein main)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

// jsdom kennt keine Passkeys; so sieht die Maske einen Browser, der sie kann.
const mitPasskeys = (w) => {
  w.PublicKeyCredential = function () {};
  Object.defineProperty(w, 'isSecureContext', { value: true });
  Object.defineProperty(w.navigator, 'credentials', { value: {} });
};

async function maske(status) {
  const o = await oeffneOberflaeche({ '/v1/auth/registration-status': status }, { angemeldet: false, vorher: mitPasskeys });
  await warte(() => o.aufrufe.some(a => a.url.includes('registration-status')));
  await warte(() => false, 100);
  const d = o.d;
  const r = { passkey: !d.getElementById('btn-passkey').hidden, vergessen: !d.getElementById('link-forgot').hidden,
              registrieren: d.getElementById('link-register-wrap').style.display !== 'none',
              main: d.querySelector('main#login-screen') !== null };
  o.w.close();
  return r;
}

test('der Server kann beides nicht', async () => {
  assert.deepEqual(await maske({ enabled: true, passkey: false, passwort_vergessen: false }),
    { passkey: false, vergessen: false, registrieren: true, main: true });
});

test('der Server kann beides', async () => {
  assert.deepEqual(await maske({ enabled: false, passkey: true, passwort_vergessen: true }),
    { passkey: true, vergessen: true, registrieren: false, main: true });
});

test('älterer Server ohne Angabe', async () => {
  assert.deepEqual(await maske({ enabled: false }), { passkey: true, vergessen: true, registrieren: false, main: true });
});
