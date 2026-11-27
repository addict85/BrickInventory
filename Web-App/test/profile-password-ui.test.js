/**
 * The profile and the own password save without asking for the current password:
 * a login is enough (docs/SICHERHEIT.md). One request, no dialog, no field
 * „Aktuelles Passwort“.
 *
 * Counter-checks (measured 26.11.2026, each on its own, bundle rebuilt):
 *   A  btn-sav-prof behind confirmDelete() again → red: “the profile saves with
 *      one request” (the dialog opens, no request)
 *   B  btn-sav-pw sends `current: ''` along again → red: “the password changes
 *      without the old one”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, view, waitFor } = require('./helpers/ui');

const PROFILE = {
  '/v2/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: true } },
};
const sent = (calls, method, end) =>
  calls.filter(a => a.method === method && a.url.endsWith(end)).map(a => JSON.parse(a.body));
const openDialog = d => d.getElementById('confirm-modal').style.display === 'flex';

test('the profile saves with one request, even a mere name change', async () => {
  const { w, d, calls } = await openUi(PROFILE);
  try {
    await view(w, 'profile');
    await waitFor(() => d.getElementById('prof-user').value === 'anna');
    assert.equal(
      d.querySelectorAll('#tab-profile input[type="password"][autocomplete="current-password"]').length,
      0,
      'no „Aktuelles Passwort“ field on the page',
    );
    d.getElementById('prof-user').value = 'anna2';
    d.getElementById('btn-sav-prof').click();
    assert.ok(await waitFor(() => sent(calls, 'PUT', '/v2/auth/profile').length === 1), 'no request');
    const [body] = sent(calls, 'PUT', '/v2/auth/profile');
    assert.equal(body.username, 'anna2');
    assert.equal('password_current' in body, false, 'no password in the request');
    assert.equal(openDialog(d), false, 'no dialog');
  } finally {
    w.close();
  }
});

test('the password changes without the old one', async () => {
  const { w, d, calls } = await openUi({ ...PROFILE, '/v2/auth/change-password': { success: true } });
  try {
    await view(w, 'profile');
    d.getElementById('pw-n').value = 'Ein-neues-Passwort-42';
    d.getElementById('pw-r').value = 'Ein-neues-Passwort-42';
    d.getElementById('btn-sav-pw').click();
    assert.ok(await waitFor(() => sent(calls, 'POST', '/v2/auth/change-password').length === 1), 'no request');
    const [body] = sent(calls, 'POST', '/v2/auth/change-password');
    assert.equal(body.newPassword, 'Ein-neues-Passwort-42');
    assert.equal('current' in body, false, 'the old password is sent along');
    assert.equal(openDialog(d), false, 'no dialog');
  } finally {
    w.close();
  }
});
