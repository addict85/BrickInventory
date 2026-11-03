/**
 * Die Dialoge der Routen mit erneuter Bestätigung bieten den zweiten Faktor
 * an: Meldet der Server zweiter_faktor_noetig, fragt die Oberfläche den Code
 * nach (oder, wo der Browser es kann und das Konto Passkeys hat, einen
 * Passkey) und wiederholt die Anfrage. Echtes Bündel in jsdom.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in 05-settings.js „Alles löschen" wieder api() direkt → rot: „Alles
 *      löschen fragt den Code nach" und „der Passkey ersetzt den Code"
 *   B  in 05-settings.js das Anlegen eines Kontos wieder api() direkt → rot:
 *      „ein Konto anlegen fragt den Code nach"
 *   C  in 23-passkeys.js setzePasskeyHolen() nicht aufgerufen → rot: „der
 *      Passkey ersetzt den Code"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

/** Antwortet ohne Code mit zweiter_faktor_noetig und merkt sich jeden Rumpf. */
function mitFaktor(liste, passkey = false) {
  return (_url, o) => {
    const body = JSON.parse(o.body);
    liste.push(body);
    return body.code || body.passkey ? { success: true, sets: 0, teile: 0, figuren: 0 }
      : { $status: 400, success: false, code: 'zweiter_faktor_noetig', error: 'Code fehlt', ...(passkey ? { passkey: true } : {}) };
  };
}

async function bestaetige(d, { passwort, code }) {
  const modal = d.getElementById('confirm-modal');
  assert.ok(await warte(() => modal.style.display === 'flex' && !d.getElementById('cd-pw-wrap').hidden), 'der Passwortdialog erscheint');
  d.getElementById('cd-pw').value = passwort;
  d.getElementById('cd-confirm').click();
  await takt(20);
  const codeWrap = d.getElementById('cd-code-wrap');
  assert.ok(await warte(() => !codeWrap.hidden && modal.style.display === 'flex'), 'der Code-Dialog erscheint');
  if (code === undefined) return;
  d.getElementById('cd-code').value = code;
  d.getElementById('cd-confirm').click();
}

test('Alles löschen fragt den Code nach', async () => {
  const rufe = [];
  const { w, d } = await oeffneOberflaeche({ '/v1/bestand': mitFaktor(rufe) });
  try {
    d.getElementById('btn-dall').click();
    await bestaetige(d, { passwort: 'Mein-Passwort-1', code: '654321' });
    assert.ok(await warte(() => rufe.length === 2), `nur ${rufe.length} Anfrage(n)`);
    assert.deepEqual(rufe, [{ password: 'Mein-Passwort-1' }, { password: 'Mein-Passwort-1', code: '654321' }]);
    assert.equal(d.getElementById('cd-passkey').hidden, true, 'ohne Passkey-Fähigkeit kein Passkey-Knopf');
  } finally { w.close(); }
});

test('ein Konto anlegen fragt den Code nach', async () => {
  const rufe = [];
  const { w, d } = await oeffneOberflaeche({ '/v1/auth/users': (url, o) => (o?.method === 'POST' ? mitFaktor(rufe)(url, o)
    : { success: true, users: [] }) });
  try {
    d.getElementById('nu-n').value = 'bert';
    d.getElementById('nu-p').value = 'Lang-genug-Passwort-1';
    d.getElementById('btn-cu').click();
    await bestaetige(d, { passwort: 'Verwalter-Passwort-1', code: '111222' });
    assert.ok(await warte(() => rufe.length === 2), `nur ${rufe.length} Anfrage(n)`);
    assert.equal(rufe[1].admin_password, 'Verwalter-Passwort-1');
    assert.equal(rufe[1].code, '111222', 'die zweite Anfrage trägt den Code');
  } finally { w.close(); }
});

test('der Passkey ersetzt den Code', async () => {
  const rufe = [];
  const puffer = () => new Uint8Array([1, 2, 3]).buffer;
  const { w, d } = await oeffneOberflaeche({
    '/v1/bestand': mitFaktor(rufe, true),
    '/v1/auth/passkey/anmelden/optionen': { success: true, optionen: { challenge: 'AAAA', allowCredentials: [] } },
  }, { vorher: (fenster) => {
    fenster.PublicKeyCredential = function PublicKeyCredential() {};
    Object.defineProperty(fenster, 'isSecureContext', { value: true });
    Object.defineProperty(fenster.navigator, 'credentials', { value: { get: async () => ({
      id: 'pk1', rawId: puffer(), type: 'public-key', getClientExtensionResults: () => ({}),
      response: { clientDataJSON: puffer(), authenticatorData: puffer(), signature: puffer(), userHandle: null } }) } });
  } });
  try {
    d.getElementById('btn-dall').click();
    await bestaetige(d, { passwort: 'Mein-Passwort-1' });
    const knopf = d.getElementById('cd-passkey');
    assert.equal(knopf.hidden, false, 'der Passkey-Knopf erscheint');
    knopf.click();
    assert.ok(await warte(() => rufe.length === 2), `der Passkey ersetzt den Code: nur ${rufe.length} Anfrage(n)`);
    assert.equal(rufe[1].passkey?.id, 'pk1', 'der Passkey ersetzt den Code');
    assert.equal(rufe[1].code, undefined);
  } finally { w.close(); }
});
