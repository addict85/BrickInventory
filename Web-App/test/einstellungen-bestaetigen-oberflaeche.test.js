/**
 * Registrierung und API-Schlüssel ändert der Server nur mit Passwort. Die
 * Oberfläche schickt erst ohne; verlangt der Server es
 * (aktuelles_passwort_erforderlich), fragt sie im Dialog und schickt erneut.
 * Abbrechen nimmt das Häkchen zurück.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  saveRegEnabled() wieder mit api('POST', …) statt speichereEinstellungen()
 *      → rot: „die Registrierung fragt nach dem Passwort“, „Abbrechen …“
 *   B  btn-sav-rb wieder mit api('POST', …) → rot: „der API-Schlüssel fragt …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

const dialogOffen = d => d.getElementById('confirm-modal').style.display === 'flex';
const posts = aufrufe =>
  aufrufe.filter(a => a.method === 'POST' && /\/v1\/settings$/.test(a.url)).map(a => JSON.parse(a.body));
/** Der Server verlangt das Passwort, bis es im Rumpf steht. */
const SERVER = {
  '/v1/settings': (_url, o) =>
    o?.method === 'POST' && !JSON.parse(o.body).admin_password
      ? {
          $status: 400,
          success: false,
          code: 'aktuelles_passwort_erforderlich',
          error: 'Bitte das aktuelle Passwort eingeben.',
        }
      : { success: true },
};

test('die Registrierung fragt nach dem Passwort', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(SERVER);
  try {
    await reiter(w, 'settings');
    const feld = d.getElementById('reg-enabled');
    feld.checked = true;
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => dialogOffen(d)), 'kein Dialog');
    d.getElementById('cd-pw').value = 'Chef-Passwort-1';
    d.getElementById('cd-confirm').click();
    await warte(() => posts(aufrufe).length === 2);
    assert.deepEqual(posts(aufrufe), [
      { registration_enabled: '1' },
      { registration_enabled: '1', admin_password: 'Chef-Passwort-1' },
    ]);
  } finally {
    w.close();
  }
});

test('Abbrechen nimmt das Häkchen zurück', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(SERVER);
  try {
    await reiter(w, 'settings');
    const feld = d.getElementById('reg-enabled');
    feld.checked = true;
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => dialogOffen(d)), 'kein Dialog');
    d.getElementById('cd-cancel').click();
    await warte(() => !dialogOffen(d));
    await warte(() => !feld.checked, 500);
    assert.equal(feld.checked, false, 'das Häkchen bleibt nach Abbrechen stehen');
    assert.equal(posts(aufrufe).length, 1);
  } finally {
    w.close();
  }
});

test('der API-Schlüssel fragt nach dem Passwort', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(SERVER);
  try {
    await reiter(w, 'settings');
    d.getElementById('rb-key').value = 'neuer-schluessel';
    d.getElementById('btn-sav-rb').click();
    assert.ok(await warte(() => dialogOffen(d)), 'kein Dialog');
    d.getElementById('cd-pw').value = 'Chef-Passwort-1';
    d.getElementById('cd-confirm').click();
    await warte(() => posts(aufrufe).length === 2);
    assert.equal(posts(aufrufe)[1].admin_password, 'Chef-Passwort-1');
    assert.equal(posts(aufrufe)[1].rebrickable_api_key, 'neuer-schluessel');
  } finally {
    w.close();
  }
});
