/**
 * The login form only offers methods the server can do: without a passkey
 * address no passkey button, without mail sending no „Passwort vergessen?“.
 * If the information is missing (older server), everything stays as before. The form is
 * a <main>, so that screen readers find a main region there.
 *
 * Counter-checks (measured 02.11.2026, each on its own):
 *   A  the two new lines removed in checkRegistrationEnabled() → red:
 *      “the server can do neither” (passkey button and link visible)
 *   B  link hidden even without information (hidden = !d.passwort_vergessen) → red:
 *      “older server without the information”
 *   C  #login-screen again <div> → all three red (no main)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

// jsdom knows no passkeys; this way the form sees a browser that can do them.
const withPasskeys = w => {
  w.PublicKeyCredential = () => {};
  Object.defineProperty(w, 'isSecureContext', { value: true });
  Object.defineProperty(w.navigator, 'credentials', { value: {} });
};

async function mask(status) {
  const o = await openUi({ '/v1/auth/registration-status': status }, { loggedIn: false, before: withPasskeys });
  await warte(() => o.aufrufe.some(a => a.url.includes('registration-status')));
  await warte(() => false, 100);
  const d = o.d;
  const r = {
    passkey: !d.getElementById('btn-passkey').hidden,
    vergessen: !d.getElementById('link-forgot').hidden,
    registrieren: d.getElementById('link-register-wrap').style.display !== 'none',
    main: d.querySelector('main#login-screen') !== null,
  };
  o.w.close();
  return r;
}

test('the server can do neither', async () => {
  assert.deepEqual(await mask({ enabled: true, passkey: false, passwort_vergessen: false }), {
    passkey: false,
    vergessen: false,
    registrieren: true,
    main: true,
  });
});

test('the server can do both', async () => {
  assert.deepEqual(await mask({ enabled: false, passkey: true, passwort_vergessen: true }), {
    passkey: true,
    vergessen: true,
    registrieren: false,
    main: true,
  });
});

test('older server without the information', async () => {
  assert.deepEqual(await mask({ enabled: false }), {
    passkey: true,
    vergessen: true,
    registrieren: false,
    main: true,
  });
});
