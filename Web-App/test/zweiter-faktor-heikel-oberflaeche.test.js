/**
 * Die Oberfläche fragt den Code nach, wenn der Server für eine heikle
 * Änderung zweiter_faktor_noetig meldet, und wiederholt die Anfrage mit
 * `code` (mitZweitemFaktor in public/js/admin.js). Geprüft am Pflichtwechsel
 * des Startpassworts, echtes Bündel in jsdom.
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  im Pflichtwechsel (api.js) wieder api() direkt statt
 *      mitZweitemFaktor → rot: „der Code-Dialog erscheint"
 *   B  in mitZweitemFaktor `code` nicht mitgeschickt → rot: „die zweite
 *      Anfrage trägt den Code"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

test('Pflichtwechsel mit zweitem Faktor fragt den Code nach', async () => {
  const wechsel = [];
  const { w, d } = await oeffneOberflaeche({
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
