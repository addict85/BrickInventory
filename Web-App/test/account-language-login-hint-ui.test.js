/**
 * Two texts that did not fit the situation (UI review 03.11.2026):
 *   - The empty build list stayed German when the account speaks English but the
 *     browser started in German — it was drawn before the account language.
 *   - “Resend confirmation link” appeared on every wrong password; it
 *     only belongs to a refusal “address not confirmed”.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  plRenderSets() back with titel/text instead of titleKey/textKey → red:
 *      “build list in account language” (“Noch keine Sets …”; measured again 13.11.2026
 *      with titel instead of titleKey: “Diese Bauliste ist noch leer”)
 *   B  in doLogin back to d.code==='credentials_invalid' → red: both
 *      login tests
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor, tick } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

test('build list in the account language', async () => {
  const { w, d } = await openUi({
    '/v2/settings/raw': { success: true, settings: { currency: 'EUR', language: 'en', rebrickable_api_key: 'probe' } },
  });
  try {
    await switchTab(w, 'partslist');
    await waitFor(() => d.documentElement.lang === 'en');
    await tick(50);
    const empty = text(d.querySelector('#pl-sets .empty-state'));
    assert.doesNotMatch(empty, /Bauliste|Noch keine|Setnummer/, `deutsch: ${empty}`);
    assert.match(empty, /build list is still empty/i);
  } finally {
    w.close();
  }
});

async function signIn(response) {
  const o = await openUi({ '/v2/auth/login': response }, { loggedIn: false });
  await waitFor(() => o.d.getElementById('login-screen').style.display === 'flex');
  o.d.getElementById('lu').value = 'anna';
  o.d.getElementById('lp').value = 'falsch-falsch';
  o.d.getElementById('btn-login').click();
  await waitFor(() => text(o.d.getElementById('lerr')) !== '');
  return o;
}

test('login: wrong password without confirmation link', async () => {
  const { w, d } = await signIn({
    $status: 401,
    success: false,
    code: 'credentials_invalid',
    error: 'Benutzername oder Passwort falsch',
  });
  try {
    assert.equal(d.querySelector('#lerr [data-click="resendConfirmation"]'), null);
  } finally {
    w.close();
  }
});

test('login: address not confirmed, with confirmation link', async () => {
  const { w, d } = await signIn({
    $status: 403,
    success: false,
    code: 'email_not_confirmed',
    unverified: true,
    error: 'E-Mail-Adresse noch nicht bestätigt',
  });
  try {
    assert.ok(d.querySelector('#lerr [data-click="resendConfirmation"]'));
  } finally {
    w.close();
  }
});
