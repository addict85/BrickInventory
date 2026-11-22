/**
 * Form errors hang at the field: aria-invalid marks it, aria-describedby
 * refers to the message, focus jumps into it; typing removes the
 * marking. On the real bundle in jsdom, login and registration.
 *
 * Counter-checks (measured 02.11.2026, each alone, bundle rebuilt):
 *   A  doLogin calls formError without fields → red: “wrong password”
 *   B  input listener removed in formular.js → red: “typing removes the marking”
 *   C  registration: field list empty for missing required fields → red:
 *      “registration: empty required fields”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt } = require('./helpers/ui');

test('login: errors at the field', async t => {
  const { w, d } = await openUi(
    {
      '/v1/auth/login': {
        $status: 401,
        success: false,
        error: 'Benutzername oder Passwort falsch',
        code: 'anmeldedaten_ungueltig',
      },
    },
    { angemeldet: false },
  );
  try {
    d.getElementById('lu').value = 'anna';
    d.getElementById('lp').value = 'wrong';
    d.getElementById('btn-login').click();
    await warte(() => d.getElementById('lerr').textContent.length > 0);
    await t.test('wrong password', () => {
      for (const id of ['lu', 'lp']) {
        const f = d.getElementById(id);
        assert.equal(f.getAttribute('aria-invalid'), 'true', id);
        assert.match(f.getAttribute('aria-describedby') || '', /\blerr\b/, id);
      }
      assert.equal(d.activeElement.id, 'lp');
    });
    await t.test('typing removes the marking', () => {
      const lp = d.getElementById('lp');
      lp.value = 'new';
      lp.dispatchEvent(new w.Event('input', { bubbles: true }));
      assert.equal(lp.hasAttribute('aria-invalid'), false);
      assert.equal(d.getElementById('lu').getAttribute('aria-invalid'), 'true', 'das andere Feld bleibt markiert');
    });
  } finally {
    w.close();
  }
});

test('registration: empty required fields', async () => {
  const { w, d } = await openUi({}, { angemeldet: false });
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
  } finally {
    w.close();
  }
});
