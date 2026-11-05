/**
 * Formularfehler hängen am Feld: aria-invalid markiert es, aria-describedby
 * verweist auf die Meldung, der Fokus springt hinein; Tippen nimmt die
 * Markierung weg. Am echten Bündel in jsdom, Anmeldung und Registrierung.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  doLogin ruft formularFehler ohne Felder auf → rot: „falsches Passwort“
 *   B  input-Hörer in 01-formular.js entfernt → rot: „Tippen nimmt die Markierung“
 *   C  Registrierung: Feldliste bei fehlenden Pflichtfeldern leer → rot:
 *      „Registrierung: leere Pflichtfelder“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

test('Anmeldung: Fehler am Feld', async (t) => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/auth/login': { $status: 401, success: false, error: 'Benutzername oder Passwort falsch' },
  }, { angemeldet: false });
  try {
    d.getElementById('lu').value = 'anna'; d.getElementById('lp').value = 'falsch';
    d.getElementById('btn-login').click();
    await warte(() => d.getElementById('lerr').textContent.length > 0);
    await t.test('falsches Passwort', () => {
      for (const id of ['lu', 'lp']) {
        const f = d.getElementById(id);
        assert.equal(f.getAttribute('aria-invalid'), 'true', id);
        assert.match(f.getAttribute('aria-describedby') || '', /\blerr\b/, id);
      }
      assert.equal(d.activeElement.id, 'lp');
    });
    await t.test('Tippen nimmt die Markierung', () => {
      const lp = d.getElementById('lp');
      lp.value = 'neu'; lp.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.equal(lp.hasAttribute('aria-invalid'), false);
      assert.equal(d.getElementById('lu').getAttribute('aria-invalid'), 'true', 'das andere Feld bleibt markiert');
    });
  } finally { w.close(); }
});

test('Registrierung: leere Pflichtfelder', async () => {
  const { w, d } = await oeffneOberflaeche({}, { angemeldet: false });
  try {
    d.getElementById('link-register').click();
    d.getElementById('reg-user').value = 'bert';
    d.getElementById('btn-register').click();
    await takt(20);
    assert.ok(d.getElementById('reg-err').textContent.length > 0);
    assert.equal(d.getElementById('reg-user').hasAttribute('aria-invalid'), false);
    for (const id of ['reg-email', 'reg-pass']) {
      assert.equal(d.getElementById(id).getAttribute('aria-invalid'), 'true', id);
      assert.match(d.getElementById(id).getAttribute('aria-describedby') || '', /\breg-err\b/);
    }
    assert.equal(d.activeElement.id, 'reg-email');
  } finally { w.close(); }
});
