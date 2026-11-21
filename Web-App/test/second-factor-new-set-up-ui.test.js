/**
 * Second factor in the profile, in jsdom. An admin must have one: for him „Abschalten“ means
 * „Neu einrichten“, a dialog asks for password and code together, and the setup begins right away
 * in the required field — without a second password question, with „Schlüssel kopieren“ and an otpauth:// link for the
 * phone. An ordinary account switches off as the text says, without a setup afterwards.
 *
 * Counter-checks (measured 16.11.2026, each on its own, bundle rebuilt):
 *   A  `withCode: true` deleted in zfAbschalten() → red: both tests (code field hidden)
 *   B  in zfAbschalten() `begonnen = null` instead of the setup → red: “admin” (no key in the
 *      required field)
 *   C  the otpauth link never made visible → red: “admin” (link hidden)
 *   D  button always „Abschalten“ → red: “admin” ('Abschalten' instead of 'Neu einrichten')
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, sicht, warte, ANMELDUNG } = require('./helpers/ui');

const OTPAUTH = 'otpauth://totp/BrickInventory:anna?secret=JBSWY3DPEHPK3PXP&issuer=BrickInventory';

function oeffne(verwalter, kopiert) {
  return openUi(
    {
      '/v1/auth/me': {
        ...ANMELDUNG['/v1/auth/me'],
        user: { ...ANMELDUNG['/v1/auth/me'].user, is_admin: verwalter },
      },
      '/v1/auth/profile': {
        success: true,
        user: { username: 'anna', email: 'anna@example.org', email_verified: true },
      },
      '/v1/auth/zweiter-faktor': { success: true, aktiv: true, codes_uebrig: 5 },
      '/v1/auth/zweiter-faktor/abschalten': { success: true },
      '/v1/auth/zweiter-faktor/einrichten': { success: true, geheimnis: 'JBSWY3DPEHPK3PXP', otpauth: OTPAUTH },
    },
    {
      vorher: w =>
        Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => kopiert.push(t) } }),
    },
  );
}

const dialog = d => ({
  offen: d.getElementById('confirm-modal').style.display === 'flex',
  titel: d.getElementById('cd-title').textContent,
  text: d.getElementById('cd-msg').textContent,
  pw: !d.getElementById('cd-pw-wrap').hidden,
  code: !d.getElementById('cd-code-wrap').hidden,
});

test('administrator: set up again in one dialog, then key and link', async () => {
  const kopiert = [];
  const { w, d, aufrufe } = await oeffne(true, kopiert);
  try {
    await sicht(w, 'profil');
    await warte(() => d.querySelector('#zf-flaeche [data-click="zfAbschalten"]'));
    const knopf = d.querySelector('#zf-flaeche [data-click="zfAbschalten"]');
    assert.equal(knopf.textContent.trim(), 'Neu einrichten');
    knopf.click();
    await warte(() => dialog(d).offen);
    const f = dialog(d);
    assert.deepEqual([f.titel, f.pw, f.code], ['Neu einrichten', true, true], JSON.stringify(f));
    assert.match(f.text, /Administrator.*neuen ein/);
    d.getElementById('cd-pw').value = 'geheim-Passwort-1';
    d.getElementById('cd-code').value = '123456';
    d.getElementById('cd-confirm').click();
    await warte(() => aufrufe.some(a => a.url.endsWith('/zweiter-faktor/einrichten')));
    const ab = aufrufe.find(a => a.url.endsWith('/zweiter-faktor/abschalten'));
    assert.deepEqual(JSON.parse(ab.body), { password: 'geheim-Passwort-1', code: '123456' });
    const ein = aufrufe.find(a => a.url.endsWith('/zweiter-faktor/einrichten'));
    assert.deepEqual(JSON.parse(ein.body), { password: 'geheim-Passwort-1' });
    assert.ok(
      await warte(() => d.querySelector('#zf-pflicht-flaeche #zf-schluessel')),
      'kein Schlüssel im Pflichtfeld',
    );
    assert.equal(d.getElementById('panel-zweitpflicht').style.display, 'block', 'Pflichtfeld nicht offen');
    assert.equal(d.getElementById('zf-start'), null, 'noch einmal „Einrichten“');
    assert.equal(dialog(d).offen, false, 'zweite Passwortfrage');
    const link = d.getElementById('zf-otpauth');
    assert.equal(link.hidden, false, 'Link verborgen');
    assert.equal(link.getAttribute('href'), OTPAUTH);
    d.querySelector('[data-click="zfSchluesselKopieren"]').click();
    assert.ok(await warte(() => kopiert.length === 1));
    assert.equal(kopiert[0], 'JBSWY3DPEHPK3PXP');
  } finally {
    w.close();
  }
});

test('account without admin rights: switching off as announced, without setup', async () => {
  const { w, d, aufrufe } = await oeffne(false, []);
  try {
    await sicht(w, 'profil');
    await warte(() => d.querySelector('#zf-flaeche [data-click="zfAbschalten"]'));
    d.querySelector('#zf-flaeche [data-click="zfAbschalten"]').click();
    await warte(() => dialog(d).offen);
    const f = dialog(d);
    assert.deepEqual([f.titel, f.pw, f.code], ['Abschalten', true, true], JSON.stringify(f));
    assert.match(f.text, /Passwort allein/);
    d.getElementById('cd-pw').value = 'geheim-Passwort-1';
    d.getElementById('cd-confirm').click();
    await warte(() => aufrufe.some(a => a.url.endsWith('/zweiter-faktor/abschalten')));
    await warte(() => !dialog(d).offen);
    assert.equal(
      aufrufe.some(a => a.url.endsWith('/zweiter-faktor/einrichten')),
      false,
      'Einrichtung ohne Pflicht',
    );
  } finally {
    w.close();
  }
});
