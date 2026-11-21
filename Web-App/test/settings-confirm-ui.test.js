/**
 * The server only changes registration and API key with a password. The
 * UI sends without it first; if the server demands it
 * (aktuelles_passwort_erforderlich), it asks in a dialog and sends again.
 * Cancelling takes the checkmark back.
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  saveRegEnabled() again with api('POST', …) instead of saveSettings()
 *      → red: “registration asks for the password”, „Abbrechen …“
 *   B  btn-sav-rb again with api('POST', …) → red: “the API key asks …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const openDialog = d => d.getElementById('confirm-modal').style.display === 'flex';
const posts = aufrufe =>
  aufrufe.filter(a => a.method === 'POST' && /\/v1\/settings$/.test(a.url)).map(a => JSON.parse(a.body));
/** The server demands the password until it stands in the body. */
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

test('registration asks for the password', async () => {
  const { w, d, aufrufe } = await openUi(SERVER);
  try {
    await reiter(w, 'settings');
    const feld = d.getElementById('reg-enabled');
    feld.checked = true;
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => openDialog(d)), 'kein Dialog');
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

test('cancel takes back the checkmark', async () => {
  const { w, d, aufrufe } = await openUi(SERVER);
  try {
    await reiter(w, 'settings');
    const feld = d.getElementById('reg-enabled');
    feld.checked = true;
    feld.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => openDialog(d)), 'kein Dialog');
    d.getElementById('cd-cancel').click();
    await warte(() => !openDialog(d));
    await warte(() => !feld.checked, 500);
    assert.equal(feld.checked, false, 'das Häkchen bleibt nach Abbrechen stehen');
    assert.equal(posts(aufrufe).length, 1);
  } finally {
    w.close();
  }
});

test('the API key asks for the password', async () => {
  const { w, d, aufrufe } = await openUi(SERVER);
  try {
    await reiter(w, 'settings');
    d.getElementById('rb-key').value = 'neuer-schluessel';
    d.getElementById('btn-sav-rb').click();
    assert.ok(await warte(() => openDialog(d)), 'kein Dialog');
    d.getElementById('cd-pw').value = 'Chef-Passwort-1';
    d.getElementById('cd-confirm').click();
    await warte(() => posts(aufrufe).length === 2);
    assert.equal(posts(aufrufe)[1].admin_password, 'Chef-Passwort-1');
    assert.equal(posts(aufrufe)[1].rebrickable_api_key, 'neuer-schluessel');
  } finally {
    w.close();
  }
});
