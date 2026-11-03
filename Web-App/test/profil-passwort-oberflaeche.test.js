/**
 * Das Profil speichert nur mit dem aktuellen Passwort, auch wenn sich bloss
 * der Benutzername ändert: Der Server verlangt es für jede Änderung, damit
 * sich über das Profil nicht durchprobieren lässt, welche Namen vergeben sind.
 *
 * Gegenproben (am 03.11.2026 gemessen, je einzeln):
 *   A  in btn-sav-prof die Prüfung `if (!pwC)` entfernt → rot: „ohne Passwort
 *      geht keine Anfrage hinaus“
 *   B  password_current wieder nur bei neuer E-Mail-Adresse mitgeschickt →
 *      rot: „mit Passwort geht es mit“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, sicht, warte } = require('./helpers/oberflaeche');

const PROFIL = { '/v1/auth/profile': { success: true, user: { username: 'anna', email: 'anna@example.org', email_verified: 1 } } };
const putAufrufe = (aufrufe) => aufrufe.filter(a => a.method === 'PUT' && a.url.endsWith('/v1/auth/profile'));

test('ohne Passwort geht keine Anfrage hinaus', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(PROFIL);
  try {
    await sicht(w, 'profil');
    await warte(() => d.getElementById('prof-user').value === 'anna');
    assert.equal(d.getElementById('prof-pw-zeile').hidden, false, 'das Passwortfeld steht da');
    d.getElementById('prof-user').value = 'anna2';
    d.getElementById('btn-sav-prof').click();
    await warte(() => /aktuelle Passwort/.test(d.getElementById('toasts').textContent));
    assert.match(d.getElementById('toasts').textContent, /Zum Speichern bitte das aktuelle Passwort eingeben/);
    assert.deepEqual(putAufrufe(aufrufe), []);
  } finally { w.close(); }
});

test('mit Passwort geht es mit, auch bei blossem Namenswechsel', async () => {
  const { w, d, aufrufe } = await oeffneOberflaeche(PROFIL);
  try {
    await sicht(w, 'profil');
    await warte(() => d.getElementById('prof-user').value === 'anna');
    d.getElementById('prof-user').value = 'anna2';
    d.getElementById('prof-pw').value = 'Mein-Passwort-1';
    d.getElementById('btn-sav-prof').click();
    await warte(() => putAufrufe(aufrufe).length);
    const rumpf = JSON.parse(putAufrufe(aufrufe)[0].body);
    assert.equal(rumpf.username, 'anna2');
    assert.equal(rumpf.password_current, 'Mein-Passwort-1');
    await warte(() => d.getElementById('prof-pw').value === '');
    assert.equal(d.getElementById('prof-pw').value, '', 'das Passwort bleibt nicht im Feld stehen');
  } finally { w.close(); }
});
