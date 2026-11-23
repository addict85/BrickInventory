/**
 * Setup state before login — on the real bundle in jsdom.
 *
 * Counter-checks:
 *   A  data-click="checkSetup" removed on the button → red: “the dialog opens”
 *   B  classList.toggle('ok', …) removed                  → red: „bereit steht als Text“
 *   C  `G('es-list').hidden = !!d.erledigt` removed      → red: „nach Abschluss keine Liste“
 *   D  `knopf.hidden = …konfiguriert === true` inverted  → red: „ohne Quelle bleibt der Prüfknopf“, „mit Quelle verschwindet er“
 *   E  the line with `hinweis.hidden = knopf.hidden` removed → red: “the state shows … per check” (the hint never becomes visible)
 *   F  es.link_hint removed from en.js → red: “English: button and hint” and “the state shows …” (08.11.2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

const ANTWORT = {
  success: true,
  done: false,
  configured: false,
  steps: [
    { id: 'database', ok: true, required: true },
    { id: 'base_url', ok: true, required: true },
    { id: 'https', ok: false, required: false },
    { id: 'ca', ok: false, required: true },
    { id: 'account', ok: true, required: true },
    { id: 'source', ok: false, required: true },
  ],
  ca: { existing: false, download: '/ca.crt' },
  base_url: null,
  https: false,
};

test('the state shows ready or missing per check', async () => {
  const { w, d, ruhig } = await openUi({ '/v2/setup/state': ANTWORT }, { loggedIn: false });
  try {
    await ruhig();
    // Without a stored source the check belongs to the initial setup and stands there.
    assert.equal(d.getElementById('btn-setup-check').hidden, false, 'without a source the check button stays');
    // First-time users must read at the button what is checked.
    assert.equal(d.getElementById('btn-setup-check').textContent.trim(), 'Was fehlt noch zur Einrichtung?');
    const hint = d.getElementById('setup-check-hint');
    assert.equal(hint.hidden, false, 'the hint is next to the button');
    assert.match(hint.textContent, /Datenbank, HTTPS, erstes Konto und Rebrickable-Schlüssel/);
    assert.equal(d.getElementById('btn-setup-check').getAttribute('aria-describedby'), hint.id);
    d.getElementById('btn-setup-check').click();
    await warte(() => d.getElementById('setup-status-modal').classList.contains('open'));
    await warte(() => d.querySelectorAll('#es-list .es-row').length === 6);

    assert.equal(d.querySelectorAll('#es-list .es-row').length, 6, 'every check needs a row');
    assert.ok(d.getElementById('es-database').classList.contains('ok'), 'ready is not marked as such');
    assert.equal(d.querySelector('#es-database .es-value').textContent, 'bereit', 'ready is shown as text');
    assert.ok(d.getElementById('es-ca').classList.contains('missing'));
    assert.equal(d.querySelector('#es-ca .es-value').textContent, 'fehlt');
    // The missing certificate names the reason, not only the color.
    assert.match(d.getElementById('es-ca-fp').textContent, /CA_ZERTIFIKAT/);
    assert.equal(d.getElementById('es-ca-link').hidden, true, 'without a certificate no download');
    assert.match(d.getElementById('es-banner').textContent, /noch nicht abgeschlossen/);
  } finally {
    w.close();
  }
});

test('with a stored source the check button disappears', async () => {
  const response = { ...ANTWORT, configured: true };
  const { w, d, ruhig } = await openUi({ '/v2/setup/state': response }, { loggedIn: false });
  try {
    await ruhig();
    assert.equal(d.getElementById('btn-setup-check').hidden, true, 'with a source it disappears');
    assert.equal(d.getElementById('setup-check-hint').hidden, true, 'with a source the hint disappears too');
  } finally {
    w.close();
  }
});

test('after completion the message stays, the checklist disappears', async () => {
  const response = { ...ANTWORT, done: true, steps: [] };
  const { w, d } = await openUi({ '/v2/setup/state': response }, { loggedIn: false });
  try {
    d.getElementById('btn-setup-check').click();
    await warte(() => d.getElementById('es-banner').textContent.includes('abgeschlossen'));
    assert.equal(d.getElementById('es-list').hidden, true, 'after completion no list');
    assert.ok(d.getElementById('es-banner').classList.contains('done'));
  } finally {
    w.close();
  }
});

test('English: button and hint', async () => {
  const { w, d, ruhig } = await openUi({ '/v2/setup/state': ANTWORT }, { loggedIn: false, language: 'en' });
  try {
    await ruhig();
    await warte(() => d.getElementById('btn-setup-check').textContent.trim() === 'What is still missing in the setup?');
    assert.match(
      d.getElementById('setup-check-hint').textContent,
      /database, HTTPS, first account and Rebrickable key/,
    );
  } finally {
    w.close();
  }
});
