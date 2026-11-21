/**
 * The UI asks for the code when the server reports zweiter_faktor_noetig for a sensitive
 * change, and repeats the request with
 * `code` (withSecondFactor in public/js/admin.js). Checked on the mandatory change
 * of the start password, real bundle in jsdom.
 *
 * Counter-checks (measured 01.11.2026, each on its own, bundle rebuilt):
 *   A  in the mandatory change (api.js) again api() directly instead of
 *      withSecondFactor → red: „der Code-Dialog erscheint"
 *   B  `code` not sent along in withSecondFactor → red: „die zweite
 *      Anfrage trägt den Code"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt } = require('./helpers/ui');

test('mandatory change with second factor asks for the code', async () => {
  const wechsel = [];
  const { w, d } = await openUi({
    '/v1/auth/me': { loggedIn: true, user: { id: 1, username: 'anna', is_admin: false, mustChangePassword: true } },
    '/v1/auth/change-password': (_url, o) => {
      const body = JSON.parse(o.body);
      wechsel.push(body);
      return body.code
        ? { success: true }
        : { $status: 400, success: false, code: 'zweiter_faktor_noetig', error: 'Code fehlt' };
    },
  });
  try {
    assert.ok(
      await warte(() => d.getElementById('panel-pflichtwechsel')?.style.display === 'block'),
      'Vorbedingung: Pflichtwechsel sichtbar',
    );
    d.getElementById('pflicht-alt').value = 'Start-Passwort-1';
    d.getElementById('pflicht-neu').value = 'Neues-Passwort-22';
    d.getElementById('pflicht-wdh').value = 'Neues-Passwort-22';
    w.location.reload = () => {};
    d.getElementById('btn-pflicht').click();

    const codeWrap = d.getElementById('cd-code-wrap');
    assert.ok(
      await warte(() => codeWrap && !codeWrap.hidden && d.getElementById('confirm-modal').style.display === 'flex'),
      'der Code-Dialog erscheint',
    );
    assert.equal(d.getElementById('cd-pw-wrap').hidden, true, 'kein Passwortfeld im Code-Dialog');
    d.getElementById('cd-code').value = ' 123456 ';
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => wechsel.length === 2), `nur ${wechsel.length} Anfrage(n)`);
    assert.equal(wechsel[0].code, undefined);
    assert.equal(wechsel[1].code, '123456', 'die zweite Anfrage trägt den Code');
    assert.equal(wechsel[1].newPassword, 'Neues-Passwort-22');
    await takt(20);
  } finally {
    w.close();
  }
});
