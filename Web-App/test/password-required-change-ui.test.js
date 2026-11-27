/**
 * The mandatory change of the start password asks neither for the old password
 * nor for a code: the login just happened (docs/SICHERHEIT.md). One request with
 * only the new password. Real bundle in jsdom.
 *
 * Counter-checks (measured 26.11.2026, each on its own, bundle rebuilt):
 *   A  in session.js `current: G('lp').value` sent along again → red:
 *      “one request with only the new password”
 *   B  the field `required-alt` back into index.html → red: “no field for
 *      the old password”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, waitFor, tick } = require('./helpers/ui');

test('mandatory change without old password and code', async () => {
  const change = [];
  const { w, d } = await openUi({
    '/v2/auth/me': { loggedIn: true, user: { id: 1, username: 'anna', is_admin: false, mustChangePassword: true } },
    '/v2/auth/change-password': (_url, o) => {
      change.push(JSON.parse(o.body));
      return { success: true };
    },
  });
  try {
    assert.ok(
      await waitFor(() => d.getElementById('panel-required-change')?.style.display === 'block'),
      'precondition: mandatory change visible',
    );
    const panel = d.getElementById('panel-required-change');
    assert.equal(panel.querySelector('[autocomplete="current-password"]'), null, 'no field for the old password');
    d.getElementById('required-new').value = 'Neues-Passwort-22';
    d.getElementById('required-repeat').value = 'Neues-Passwort-22';
    w.location.reload = () => {};
    d.getElementById('btn-required').click();
    assert.ok(await waitFor(() => change.length === 1), `only ${change.length} request(s)`);
    assert.deepEqual(change, [{ newPassword: 'Neues-Passwort-22' }], 'one request with only the new password');
    assert.equal(d.getElementById('confirm-modal').style.display === 'flex', false, 'no code dialog');
    await tick(20);
  } finally {
    w.close();
  }
});
