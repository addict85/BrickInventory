/**
 * Anmeldekarte in jsdom: Der Wechsel zwischen Anmelden, Registrieren und „Passwort vergessen“ setzt
 * den Fokus ins erste Feld (sonst stand er auf BODY), „Passwort vergessen“ heisst so, erklärt sich und
 * sendet mit Enter ab.
 *
 * Gegenproben (16.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in showPanel() den Fokusteil gestrichen → rot: „Fokus beim Wechsel“ (BODY statt forgot-email)
 *   B  #forgot-form wieder <div> statt <form> → rot: „Enter sendet ab“ (kein POST forgot-password)
 *   C  reset.title wieder „Neues Passwort“ → rot: „Titel“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/oberflaeche');

const klick = (d, id) => d.getElementById(id).click();
const fokus = d => d.activeElement?.id || d.activeElement?.tagName;

test('Fokus beim Wechsel der Felder der Anmeldekarte', async () => {
  const { w, d } = await openUi({}, { angemeldet: false });
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

test('Passwort vergessen: Titel, Erklärung und Enter sendet ab', async () => {
  const { w, d, aufrufe } = await openUi(
    { '/v1/auth/forgot-password': { success: true, message: 'Falls die Adresse existiert, kommt ein Link.' } },
    { angemeldet: false },
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
