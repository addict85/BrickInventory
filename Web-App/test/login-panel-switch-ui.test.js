/**
 * Login card in jsdom: switching between login, registration and „Passwort vergessen“ puts
 * the focus into the first field (before, it stood on BODY), „Passwort vergessen“ is called that, explains itself and
 * submits with Enter.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  the focus part deleted in showPanel() → red: “focus when switching” (BODY instead of forgot-email)
 *   B  #forgot-form again <div> instead of <form> → red: „Enter sendet ab“ (no POST forgot-password)
 *   C  reset.title again „Neues Passwort“ → red: „Titel“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

const klick = (d, id) => d.getElementById(id).click();
const fokus = d => d.activeElement?.id || d.activeElement?.tagName;

test('focus when switching the fields of the login card', async () => {
  const { w, d } = await openUi({}, { loggedIn: false });
  try {
    await warte(() => d.getElementById('panel-login')?.style.display !== 'none');
    klick(d, 'link-forgot');
    assert.equal(fokus(d), 'forgot-email');
    klick(d, 'link-forgot-to-login');
    assert.equal(fokus(d), 'lu');
    klick(d, 'link-register');
    assert.equal(fokus(d), 'reg-first');
    klick(d, 'link-to-login');
    assert.equal(fokus(d), 'lu');
  } finally {
    w.close();
  }
});

test('forgot password: title, explanation and Enter submits', async () => {
  const { w, d, aufrufe } = await openUi(
    { '/v1/auth/forgot-password': { success: true, message: 'Falls die Adresse existiert, kommt ein Link.' } },
    { loggedIn: false },
  );
  try {
    klick(d, 'link-forgot');
    assert.equal(d.querySelector('#panel-forgot h1').textContent.trim(), 'Passwort vergessen', 'Titel');
    assert.match(d.title, /^Passwort vergessen – /);
    const feld = d.getElementById('forgot-email');
    assert.match(d.getElementById(feld.getAttribute('aria-describedby')).textContent, /Link/);
    feld.value = 'anna@example.org';
    feld.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.ok(
      await warte(() => aufrufe.some(a => a.method === 'POST' && a.url.endsWith('/v1/auth/forgot-password'))),
      'Enter sendet ab',
    );
    assert.ok(await warte(() => d.getElementById('forgot-success').style.display === 'block'));
  } finally {
    w.close();
  }
});
