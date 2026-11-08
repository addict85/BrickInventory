/**
 * Zwei Texte, die nicht zur Lage passten (UI-Prüfung 03.11.2026):
 *   - Die leere Bauliste blieb deutsch, wenn das Konto Englisch spricht, der
 *     Browser aber deutsch startete — sie war vor der Kontosprache gezeichnet.
 *   - „Bestätigungslink erneut senden“ stand bei jedem falschen Passwort; er
 *     gehört nur zu einer Absage „Adresse nicht bestätigt“.
 *
 * Gegenproben (am 03.11.2026 gemessen):
 *   A  plRenderSets() wieder mit titel/text statt titelKey/textKey → rot:
 *      „Bauliste in Kontosprache“ („Noch keine Sets …“)
 *   B  in doLogin wieder d.code==='anmeldedaten_ungueltig' → rot: beide
 *      Anmelde-Tests
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte, takt } = require('./helpers/oberflaeche');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

test('Bauliste in Kontosprache', async () => {
  const { w, d } = await oeffneOberflaeche({
    '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'en', rebrickable_api_key: 'probe' } } });
  try {
    await reiter(w, 'partslist');
    await warte(() => d.documentElement.lang === 'en');
    await takt(50);
    const leer = text(d.querySelector('#pl-sets .leer'));
    assert.doesNotMatch(leer, /Noch keine|Setnummer/, `deutsch: ${leer}`);
    assert.match(leer, /set/i);
  } finally { w.close(); }
});

async function anmelden(antwort) {
  const o = await oeffneOberflaeche({ '/v1/auth/login': antwort }, { angemeldet: false });
  await warte(() => o.d.getElementById('login-screen').style.display === 'flex');
  o.d.getElementById('lu').value = 'anna';
  o.d.getElementById('lp').value = 'falsch-falsch';
  o.d.getElementById('btn-login').click();
  await warte(() => text(o.d.getElementById('lerr')) !== '');
  return o;
}

test('Anmeldung: falsches Passwort ohne Bestätigungslink', async () => {
  const { w, d } = await anmelden({ $status: 401, success: false, code: 'anmeldedaten_ungueltig', error: 'Benutzername oder Passwort falsch' });
  try {
    assert.equal(d.querySelector('#lerr [data-click="bestaetigungErneut"]'), null);
  } finally { w.close(); }
});

test('Anmeldung: Adresse nicht bestätigt mit Bestätigungslink', async () => {
  const { w, d } = await anmelden({ $status: 403, success: false, code: 'email_nicht_bestaetigt', unverified: true, error: 'E-Mail-Adresse noch nicht bestätigt' });
  try {
    assert.ok(d.querySelector('#lerr [data-click="bestaetigungErneut"]'));
  } finally { w.close(); }
});
