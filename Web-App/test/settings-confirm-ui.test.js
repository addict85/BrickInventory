/**
 * The server only changes registration and API key with a password. The
 * UI sends without it first; if the server demands it
 * (current_password_required), it asks in a dialog and sends again.
 * Cancelling takes the checkmark back.
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  saveRegEnabled() again with api('POST', …) instead of saveSettings()
 *      → red: “registration asks for the password”, „Abbrechen …“
 *   B  btn-sav-rb again with api('POST', …) → red: “the API key asks …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const openDialog = d => d.getElementById('confirm-modal').style.display === 'flex';
const posts = calls =>
  calls.filter(a => a.method === 'POST' && /\/v2\/settings$/.test(a.url)).map(a => JSON.parse(a.body));
/** The server demands the password until it stands in the body. */
const SERVER = {
  '/v2/settings': (_url, o) =>
    o?.method === 'POST' && !JSON.parse(o.body).admin_password
      ? {
          $status: 400,
          success: false,
          code: 'current_password_required',
          error: 'Bitte das aktuelle Passwort eingeben.',
        }
      : { success: true },
};

test('registration asks for the password', async () => {
  const { w, d, calls } = await openUi(SERVER);
  try {
    await switchTab(w, 'settings');
    const field = d.getElementById('reg-enabled');
    field.checked = true;
    field.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await waitFor(() => openDialog(d)), 'no dialog');
    d.getElementById('cd-pw').value = 'Chef-Passwort-1';
    d.getElementById('cd-confirm').click();
    await waitFor(() => posts(calls).length === 2);
    assert.deepEqual(posts(calls), [
      { registration_enabled: '1' },
      { registration_enabled: '1', admin_password: 'Chef-Passwort-1' },
    ]);
  } finally {
    w.close();
  }
});

test('cancel takes back the checkmark', async () => {
  const { w, d, calls } = await openUi(SERVER);
  try {
    await switchTab(w, 'settings');
    const field = d.getElementById('reg-enabled');
    field.checked = true;
    field.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await waitFor(() => openDialog(d)), 'no dialog');
    d.getElementById('cd-cancel').click();
    await waitFor(() => !openDialog(d));
    await waitFor(() => !field.checked, 500);
    assert.equal(field.checked, false, 'the tick stays after cancelling');
    assert.equal(posts(calls).length, 1);
  } finally {
    w.close();
  }
});

test('the API key asks for the password', async () => {
  const { w, d, calls } = await openUi(SERVER);
  try {
    await switchTab(w, 'settings');
    d.getElementById('rb-key').value = 'neuer-schluessel';
    d.getElementById('btn-sav-rb').click();
    assert.ok(await waitFor(() => openDialog(d)), 'no dialog');
    d.getElementById('cd-pw').value = 'Chef-Passwort-1';
    d.getElementById('cd-confirm').click();
    await waitFor(() => posts(calls).length === 2);
    assert.equal(posts(calls)[1].admin_password, 'Chef-Passwort-1');
    assert.equal(posts(calls)[1].rebrickable_api_key, 'neuer-schluessel');
  } finally {
    w.close();
  }
});
