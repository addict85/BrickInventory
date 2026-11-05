/**
 * Das Profil speichert nur mit dem aktuellen Passwort, auch wenn sich bloss
 * der Benutzername ändert. Gefragt wird einmal beim Speichern in einem Dialog
 * statt in einem eigenen Feld je Abschnitt; ein falsches Passwort fragt erneut.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  in btn-sav-prof direkt api('PUT', …) ohne mitPasswortBestaetigen → rot:
 *      alle drei Fälle (es öffnet sich kein Dialog)
 *   B  in mitPasswortBestaetigen die Wiederholung bei aktuelles_passwort_falsch
 *      entfernt → rot: „falsches Passwort fragt erneut“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, sicht, warte } = require('./helpers/oberflaeche');

const PROFIL = { '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: 1 } } };
const putAufrufe = (aufrufe) => aufrufe.filter(a => a.method === 'PUT' && a.url.endsWith('/v1/auth/profile'));
const dialogOffen = (d) => d.getElementById('confirm-modal').style.display === 'flex';

async function speichern(w, d) {
  await sicht(w, 'profil');
  await warte(() => d.getElementById('prof-user').value === 'anna');
  assert.equal(d.querySelectorAll('#tab-profil input[type="password"][autocomplete="current-password"]').length, 0,
    'kein Feld „Aktuelles Passwort“ mehr auf der Seite');
  d.getElementById('prof-user').value = 'anna2';
  d.getElementById('btn-sav-prof').click();
  await warte(() => dialogOffen(d));
}

test('ohne Passwort geht keine Anfrage hinaus', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(PROFIL);
  try {
    await speichern(w, d);
    assert.deepEqual(putAufrufe(aufrufe), [], 'vor der Bestätigung');
    d.getElementById('cd-cancel').click();
    await warte(() => !dialogOffen(d));
    assert.deepEqual(putAufrufe(aufrufe), [], 'nach Abbrechen');
  } finally { w.close(); }
});

test('mit Passwort geht es mit, auch bei blossem Namenswechsel', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(PROFIL);
  try {
    await speichern(w, d);
    d.getElementById('cd-pw').value = 'Mein-Passwort-1';
    d.getElementById('cd-confirm').click();
    await warte(() => putAufrufe(aufrufe).length);
    const rumpf = JSON.parse(putAufrufe(aufrufe)[0].body);
    assert.equal(rumpf.username, 'anna2');
    assert.equal(rumpf.password_current, 'Mein-Passwort-1');
    assert.equal(d.getElementById('cd-pw').value, '', 'das Passwort bleibt nicht im Feld stehen');
  } finally { w.close(); }
});

test('falsches Passwort fragt erneut', async () => {
  let n = 0;
  const { w, d, aufrufe } = await oeffneOberflaeche({ ...PROFIL,
    '/v1/auth/profile': (_url, o) => o?.method === 'PUT' && ++n === 1
      ? { success: false, code: 'aktuelles_passwort_falsch', error: 'Aktuelles Passwort falsch' }
      : PROFIL['/v1/auth/profile'] });
  try {
    await speichern(w, d);
    d.getElementById('cd-pw').value = 'falsch';
    d.getElementById('cd-confirm').click();
    await warte(() => putAufrufe(aufrufe).length === 1 && dialogOffen(d) && /falsch/.test(d.getElementById('cd-msg').textContent));
    d.getElementById('cd-pw').value = 'richtig';
    d.getElementById('cd-confirm').click();
    await warte(() => putAufrufe(aufrufe).length === 2);
    assert.equal(JSON.parse(putAufrufe(aufrufe)[1].body).password_current, 'richtig');
  } finally { w.close(); }
});
