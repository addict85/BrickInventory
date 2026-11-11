/**
 * Die Dialoge der Routen mit erneuter Bestätigung bieten den zweiten Faktor
 * an: Meldet der Server zweiter_faktor_noetig, fragt die Oberfläche den Code
 * nach (oder, wo der Browser es kann und das Konto Passkeys hat, einen
 * Passkey) und wiederholt die Anfrage. Echtes Bündel in jsdom.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in settings.js „Alles löschen" wieder api() direkt → rot: „Alles
 *      löschen fragt den Code nach" und „der Passkey ersetzt den Code"
 *   B  in settings.js das Anlegen eines Kontos wieder api() direkt → rot:
 *      „ein Konto anlegen fragt den Code nach"
 *   C  in passkeys.js setzePasskeyHolen() nicht aufgerufen → rot: „der
 *      Passkey ersetzt den Code"
 *   D  in papierkorb.js bzw. gutscheine.js wieder confirmDelete() und
 *      api() ohne Passwort → rot: „den Papierkorb leeren …" bzw. „einen
 *      Gutschein löschen …" (der Passwortdialog erscheint nicht)
 *   E  in gutscheinPinUmschalten() holeKlartext() übergangen → rot: „die
 *      Gutscheinliste zeigt die Maske …" (kein Passwortdialog)
 *   F  gutscheinPdfOeffnen() wieder openPdfViewer() direkt → rot: „das
 *      Gutschein-PDF öffnet erst nach Bestätigung …"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt, sicht } = require('./helpers/oberflaeche');

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

test('den Papierkorb leeren fragt Passwort und Code', async () => {
  const rufe = [];
  const { w, d } = await oeffneOberflaeche({ '/v1/papierkorb': (url, o) => (o?.method === 'DELETE' ? mitFaktor(rufe)(url, o)
    : { success: true, eintraege: [] }) });
  try {
    d.getElementById('papierkorb-leeren').click();
    await bestaetige(d, { passwort: 'Mein-Passwort-1', code: '246810' });
    assert.ok(await warte(() => rufe.length === 2), `nur ${rufe.length} Anfrage(n)`);
    assert.deepEqual(rufe, [{ password: 'Mein-Passwort-1' }, { password: 'Mein-Passwort-1', code: '246810' }]);
  } finally { w.close(); }
});

test('einen Gutschein löschen fragt Passwort und Code', async () => {
  const rufe = [];
  const { w, d } = await oeffneOberflaeche({
    '/v1/vouchers': { success: true, vouchers: [{ id: 3, number: '6123456789012', pin: '4711', amount: 50, currency: 'CHF', hat_pdf: false }] },
    '/v1/vouchers/3': mitFaktor(rufe),
  });
  try {
    await sicht(w, 'gutscheine');
    assert.ok(await warte(() => d.querySelector('[data-click="gutscheinLoeschen"]')), 'Gutscheinliste');
    d.querySelector('[data-click="gutscheinLoeschen"]').click();
    await bestaetige(d, { passwort: 'Mein-Passwort-1', code: '135790' });
    assert.ok(await warte(() => rufe.length === 2), `nur ${rufe.length} Anfrage(n)`);
    assert.deepEqual(rufe[1], { password: 'Mein-Passwort-1', code: '135790' });
  } finally { w.close(); }
});

test('das Gutschein-PDF öffnet erst nach Bestätigung, mit dem Ticket', async () => {
  const freigaben = [], abrufe = [];
  const { w, d } = await oeffneOberflaeche({
    '/v1/vouchers': { success: true, vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', hat_pdf: true }] },
    '/v1/vouchers/3/pdf-freigabe': (_u, o) => { freigaben.push(JSON.parse(o.body)); return { success: true, ticket: 'T-123', gueltig_sek: 60 }; },
    '/v1/vouchers/3/pdf': (u) => { abrufe.push(String(u)); return { $status: 403, success: false, error: 'abgelehnt', code: 'kein_zugriff_konto' }; },
  });
  try {
    await sicht(w, 'gutscheine');
    assert.ok(await warte(() => d.querySelector('[data-click="gutscheinPdfOeffnen"]')), 'Gutscheinliste');
    d.querySelector('[data-click="gutscheinPdfOeffnen"]').click();
    const modal = d.getElementById('confirm-modal');
    assert.ok(await warte(() => modal.style.display === 'flex' && !d.getElementById('cd-pw-wrap').hidden), 'der Passwortdialog erscheint');
    assert.deepEqual(abrufe, [], 'das PDF wird vor der Bestätigung abgerufen');
    d.getElementById('cd-pw').value = 'Mein-Passwort-1';
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => abrufe.length === 1), 'kein Abruf des PDFs');
    assert.deepEqual(freigaben, [{ password: 'Mein-Passwort-1' }]);
    assert.match(abrufe[0], /\/api\/v1\/vouchers\/3\/pdf\?ticket=T-123$/);
  } finally { w.close(); }
});

test('die Gutscheinliste zeigt die Maske, Nummer und PIN erst nach Bestätigung', async () => {
  const rufe = [];
  const { w, d } = await oeffneOberflaeche({
    '/v1/vouchers': { success: true, vouchers: [{ id: 3, number: '…9012', pin: '•••', amount: 50, currency: 'CHF', hat_pdf: false }] },
    '/v1/vouchers/3/klartext': (_u, o) => { rufe.push(JSON.parse(o.body)); return { success: true, id: 3, number: '6123456789012', pin: '4711' }; },
  });
  try {
    await sicht(w, 'gutscheine');
    assert.ok(await warte(() => d.querySelector('.voucher-row')), 'Gutscheinliste');
    assert.equal(d.querySelector('.voucher-num').textContent, '…9012');
    d.querySelector('[data-click="gutscheinPinUmschalten"]').click();
    const modal = d.getElementById('confirm-modal');
    assert.ok(await warte(() => modal.style.display === 'flex' && !d.getElementById('cd-pw-wrap').hidden), 'der Passwortdialog erscheint');
    d.getElementById('cd-pw').value = 'Mein-Passwort-1';
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => d.querySelector('.voucher-pin code')?.textContent === '4711'), 'die PIN erscheint nach der Bestätigung');
    assert.equal(d.querySelector('.voucher-num').textContent, '6123 4567 8901 2');
    assert.deepEqual(rufe, [{ password: 'Mein-Passwort-1' }]);
  } finally { w.close(); }
});
