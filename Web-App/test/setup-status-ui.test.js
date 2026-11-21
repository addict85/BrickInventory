/**
 * Setup state before login — on the real bundle in jsdom.
 *
 * Counter-checks:
 *   A  data-click="einrichtungPruefen" removed on the button → red: “the dialog opens”
 *   B  classList.toggle('ok', …) removed                  → red: „bereit steht als Text“
 *   C  `G('es-liste').hidden = !!d.erledigt` removed      → red: „nach Abschluss keine Liste“
 *   D  `knopf.hidden = …konfiguriert === true` inverted  → red: „ohne Quelle bleibt der Prüfknopf“, „mit Quelle verschwindet er“
 *   E  the line with `hinweis.hidden = knopf.hidden` removed → red: “the state shows … per check” (the hint never becomes visible)
 *   F  es.link_hint removed from en.js → red: “English: button and hint” and “the state shows …” (08.11.2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

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

test('the state shows ready or missing per check', async () => {
  const { w, d, ruhig } = await openUi({ '/v1/einrichtung/stand': ANTWORT }, { angemeldet: false });
  try {
    await ruhig();
    // Without a stored source the check belongs to the initial setup and stands there.
    assert.equal(d.getElementById('btn-einrichtung-pruefen').hidden, false, 'ohne Quelle bleibt der Prüfknopf');
    // First-time users must read at the button what is checked.
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
    // The missing certificate names the reason, not only the color.
    assert.match(d.getElementById('es-ca-fp').textContent, /CA_ZERTIFIKAT/);
    assert.equal(d.getElementById('es-ca-link').hidden, true, 'ohne Zertifikat kein Download');
    assert.match(d.getElementById('es-banner').textContent, /noch nicht abgeschlossen/);
  } finally {
    w.close();
  }
});

test('with a stored source the check button disappears', async () => {
  const antwort = { ...ANTWORT, konfiguriert: true };
  const { w, d, ruhig } = await openUi({ '/v1/einrichtung/stand': antwort }, { angemeldet: false });
  try {
    await ruhig();
    assert.equal(d.getElementById('btn-einrichtung-pruefen').hidden, true, 'mit Quelle verschwindet er');
    assert.equal(
      d.getElementById('einrichtung-pruefen-hinweis').hidden,
      true,
      'mit Quelle verschwindet auch der Hinweis',
    );
  } finally {
    w.close();
  }
});

test('after completion the message stays, the checklist disappears', async () => {
  const antwort = { ...ANTWORT, erledigt: true, schritte: [] };
  const { w, d } = await openUi({ '/v1/einrichtung/stand': antwort }, { angemeldet: false });
  try {
    d.getElementById('btn-einrichtung-pruefen').click();
    await warte(() => d.getElementById('es-banner').textContent.includes('abgeschlossen'));
    assert.equal(d.getElementById('es-liste').hidden, true, 'nach Abschluss keine Liste');
    assert.ok(d.getElementById('es-banner').classList.contains('fertig'));
  } finally {
    w.close();
  }
});

test('English: button and hint', async () => {
  const { w, d, ruhig } = await openUi({ '/v1/einrichtung/stand': ANTWORT }, { angemeldet: false, sprache: 'en' });
  try {
    await ruhig();
    await warte(
      () => d.getElementById('btn-einrichtung-pruefen').textContent.trim() === 'What is still missing in the setup?',
    );
    assert.match(
      d.getElementById('einrichtung-pruefen-hinweis').textContent,
      /database, HTTPS, first account and Rebrickable key/,
    );
  } finally {
    w.close();
  }
});
