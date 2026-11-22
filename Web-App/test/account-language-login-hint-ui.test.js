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
 *   B  in doLogin back to d.code==='anmeldedaten_ungueltig' → red: both
 *      login tests
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte, takt } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

test('build list in the account language', async () => {
  const { w, d } = await openUi({
    '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'en', rebrickable_api_key: 'probe' } },
  });
  try {
    await reiter(w, 'partslist');
    await warte(() => d.documentElement.lang === 'en');
    await takt(50);
    const leer = text(d.querySelector('#pl-sets .empty-state'));
    assert.doesNotMatch(leer, /Bauliste|Noch keine|Setnummer/, `deutsch: ${leer}`);
    assert.match(leer, /build list is still empty/i);
  } finally {
    w.close();
  }
});

async function anmelden(antwort) {
  const o = await openUi({ '/v1/auth/login': antwort }, { angemeldet: false });
  await warte(() => o.d.getElementById('login-screen').style.display === 'flex');
  o.d.getElementById('lu').value = 'anna';
  o.d.getElementById('lp').value = 'falsch-falsch';
  o.d.getElementById('btn-login').click();
  await warte(() => text(o.d.getElementById('lerr')) !== '');
  return o;
}

test('login: wrong password without confirmation link', async () => {
  const { w, d } = await anmelden({
    $status: 401,
    success: false,
    code: 'anmeldedaten_ungueltig',
    error: 'Benutzername oder Passwort falsch',
  });
  try {
    assert.equal(d.querySelector('#lerr [data-click="resendConfirmation"]'), null);
  } finally {
    w.close();
  }
});

test('login: address not confirmed, with confirmation link', async () => {
  const { w, d } = await anmelden({
    $status: 403,
    success: false,
    code: 'email_nicht_bestaetigt',
    unverified: true,
    error: 'E-Mail-Adresse noch nicht bestätigt',
  });
  try {
    assert.ok(d.querySelector('#lerr [data-click="resendConfirmation"]'));
  } finally {
    w.close();
  }
});
