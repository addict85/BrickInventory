/**
 * Einrichtungsstand vor der Anmeldung — am echten Bündel in jsdom.
 *
 * Gegenproben:
 *   A  data-click="einrichtungPruefen" am Knopf entfernt → rot: „der Dialog öffnet sich“
 *   B  classList.toggle('ok', …) entfernt               → rot: „bereit steht als Text“
 *   C  `G('es-liste').hidden = !!d.erledigt` entfernt   → rot: „nach Abschluss keine Liste“
 *   D  `knopf.hidden = …konfiguriert === true` verdreht → rot: „ohne Quelle bleibt der Prüfknopf“, „mit Quelle verschwindet er“
 *   E  die Zeile mit `hinweis.hidden = knopf.hidden` entfernt → rot: „der Stand zeigt je Prüfung …“ (der Hinweis wird nie sichtbar)
 *   F  es.link_hint aus en.js entfernt → rot: „englisch: Knopf und Hinweis“ und „der Stand zeigt …“ (08.11.2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

const ANTWORT = {
  success: true,
  erledigt: false,
  konfiguriert: false,
  schritte: [
    { id: 'datenbank', ok: true, pflicht: true },
    { id: 'basis_url', ok: true, pflicht: true },
    { id: 'https', ok: false, pflicht: false },
    { id: 'ca', ok: false, pflicht: true },
    { id: 'konto', ok: true, pflicht: true },
    { id: 'quelle', ok: false, pflicht: true },
  ],
  ca: { vorhanden: false, download: '/ca.crt' },
  basis_url: null,
  https: false,
};

test('der Stand zeigt je Prüfung bereit oder fehlt', async () => {
  const { w, d, ruhig } = await oeffneOberflaeche({ '/v1/einrichtung/stand': ANTWORT }, { angemeldet: false });
  try {
    await ruhig();
    // Ohne hinterlegte Quelle gehört die Prüfung zur Ersteinrichtung und steht da.
    assert.equal(d.getElementById('btn-einrichtung-pruefen').hidden, false, 'ohne Quelle bleibt der Prüfknopf');
    // Erstnutzer müssen am Knopf lesen, was geprüft wird.
    assert.equal(d.getElementById('btn-einrichtung-pruefen').textContent.trim(), 'Was fehlt noch zur Einrichtung?');
    const hinweis = d.getElementById('einrichtung-pruefen-hinweis');
    assert.equal(hinweis.hidden, false, 'der Hinweis steht beim Knopf');
    assert.match(hinweis.textContent, /Datenbank, HTTPS, erstes Konto und Rebrickable-Schlüssel/);
    assert.equal(d.getElementById('btn-einrichtung-pruefen').getAttribute('aria-describedby'), hinweis.id);
    d.getElementById('btn-einrichtung-pruefen').click();
    await warte(() => d.getElementById('einrichtung-stand-modal').classList.contains('open'));
    await warte(() => d.querySelectorAll('#es-liste .es-zeile').length === 6);

    assert.equal(d.querySelectorAll('#es-liste .es-zeile').length, 6, 'jede Prüfung braucht eine Zeile');
    assert.ok(d.getElementById('es-datenbank').classList.contains('ok'), 'bereit ist nicht als solches markiert');
    assert.equal(d.querySelector('#es-datenbank .es-wert').textContent, 'bereit', 'bereit steht als Text');
    assert.ok(d.getElementById('es-ca').classList.contains('fehlt'));
    assert.equal(d.querySelector('#es-ca .es-wert').textContent, 'fehlt');
    // Das fehlende Zertifikat nennt den Grund, nicht nur die Farbe.
    assert.match(d.getElementById('es-ca-fp').textContent, /CA_ZERTIFIKAT/);
    assert.equal(d.getElementById('es-ca-link').hidden, true, 'ohne Zertifikat kein Download');
    assert.match(d.getElementById('es-banner').textContent, /noch nicht abgeschlossen/);
  } finally {
    w.close();
  }
});

test('mit hinterlegter Quelle verschwindet der Prüfknopf', async () => {
  const antwort = { ...ANTWORT, konfiguriert: true };
  const { w, d, ruhig } = await oeffneOberflaeche({ '/v1/einrichtung/stand': antwort }, { angemeldet: false });
  try {
    await ruhig();
    assert.equal(d.getElementById('btn-einrichtung-pruefen').hidden, true, 'mit Quelle verschwindet er');
    assert.equal(d.getElementById('einrichtung-pruefen-hinweis').hidden, true, 'mit Quelle verschwindet auch der Hinweis');
  } finally {
    w.close();
  }
});

test('nach Abschluss bleibt die Meldung, die Prüfliste verschwindet', async () => {
  const antwort = { ...ANTWORT, erledigt: true, schritte: [] };
  const { w, d } = await oeffneOberflaeche({ '/v1/einrichtung/stand': antwort }, { angemeldet: false });
  try {
    d.getElementById('btn-einrichtung-pruefen').click();
    await warte(() => d.getElementById('es-banner').textContent.includes('abgeschlossen'));
    assert.equal(d.getElementById('es-liste').hidden, true, 'nach Abschluss keine Liste');
    assert.ok(d.getElementById('es-banner').classList.contains('fertig'));
  } finally {
    w.close();
  }
});

test('englisch: Knopf und Hinweis', async () => {
  const { w, d, ruhig } = await oeffneOberflaeche({ '/v1/einrichtung/stand': ANTWORT }, { angemeldet: false, sprache: 'en' });
  try {
    await ruhig();
    await warte(() => d.getElementById('btn-einrichtung-pruefen').textContent.trim() === 'What is still missing in the setup?');
    assert.match(d.getElementById('einrichtung-pruefen-hinweis').textContent, /database, HTTPS, first account and Rebrickable key/);
  } finally {
    w.close();
  }
});
