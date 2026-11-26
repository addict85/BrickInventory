/**
 * Registration, API key and mail server save with ONE request and no password
 * dialog: a login is enough (docs/SICHERHEIT.md). The checkbox follows the server.
 *
 * Counter-checks (measured 26.11.2026, each on its own, bundle rebuilt):
 *   A  saveRegEnabled() sends `admin_password: ''` along again → red:
 *      “registration saves without a password”
 *   B  saveSmtp() behind confirmDelete() again → red: “the mail server saves
 *      without a dialog” (the dialog opens, no request)
 *   C  in saveRegEnabled() `if (d.success) box.checked = want` removed → red:
 *      “registration saves without a password” (the tick does not follow)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor, tick } = require('./helpers/ui');

const openDialog = d => d.getElementById('confirm-modal').style.display === 'flex';
const posts = calls =>
  calls.filter(a => a.method === 'POST' && /\/v2\/settings$/.test(a.url)).map(a => JSON.parse(a.body));

test('registration saves without a password', async () => {
  const { w, d, calls } = await openUi({ '/v2/settings': { success: true } });
  try {
    await switchTab(w, 'settings');
    const field = d.getElementById('reg-enabled');
    field.checked = true;
    field.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await waitFor(() => posts(calls).length === 1), 'no request');
    assert.deepEqual(posts(calls), [{ registration_enabled: '1' }]);
    assert.ok(await waitFor(() => field.checked), 'the tick follows the server');
    assert.equal(openDialog(d), false, 'no dialog');
  } finally {
    w.close();
  }
});

test('a refusal keeps the old state', async () => {
  const { w, d, calls } = await openUi({
    '/v2/settings': { $status: 400, success: false, code: 'registration_needs_mail', error: 'Mail fehlt' },
  });
  try {
    await switchTab(w, 'settings');
    const field = d.getElementById('reg-enabled');
    field.checked = true;
    field.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await waitFor(() => posts(calls).length === 1), 'no request');
    await tick(20);
    assert.equal(field.checked, false, 'the tick stays after the refusal');
  } finally {
    w.close();
  }
});

test('the API key saves without a password', async () => {
  const { w, d, calls } = await openUi({ '/v2/settings': { success: true } });
  try {
    await switchTab(w, 'settings');
    d.getElementById('rb-key').value = 'neuer-schluessel';
    d.getElementById('btn-sav-rb').click();
    assert.ok(await waitFor(() => posts(calls).length === 1), 'no request');
    assert.equal(posts(calls)[0].rebrickable_api_key, 'neuer-schluessel');
    assert.equal('admin_password' in posts(calls)[0], false, 'no password in the request');
    assert.equal(openDialog(d), false, 'no dialog');
  } finally {
    w.close();
  }
});

test('the mail server saves without a dialog', async () => {
  const { w, d, calls } = await openUi({ '/v2/settings': { success: true } });
  try {
    await switchTab(w, 'settings');
    d.getElementById('smtp-host').value = 'mail.neu.example';
    d.getElementById('btn-sav-smtp').click();
    assert.ok(await waitFor(() => posts(calls).length === 1), 'no request');
    assert.equal(posts(calls)[0].smtp_host, 'mail.neu.example');
    assert.equal('admin_password' in posts(calls)[0], false, 'no password in the request');
    assert.equal(openDialog(d), false, 'no dialog');
  } finally {
    w.close();
  }
});
