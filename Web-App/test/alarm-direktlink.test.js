/**
 * Eine Meldung führt zum Set: Der Knopf in der Mail trägt `?set=` (alarm-mail-knopf.test.js
 * baut sie), die Webapp öffnet damit das Set-Detail und bereinigt die Adresse. Die Seite der
 * App (Benachrichtigung, Einstieg, Manifest) prüft die Android-Suite (FremderEinstiegTest,
 * ManifestPruefenTest, tools/manifest-pruefen.py).
 *
 * Gegenproben (10.11.2026, jsdom): das Auslesen von ?set= in showApp() entfernt → rot;
 * history.replaceState dort entfernt → rot („nicht bereinigt“).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

test('4. und die Webapp löst ihn ein', async () => {
  const { openUi, warte } = require('./helpers/oberflaeche');
  const { w, d, aufrufe } = await openUi(
    {
      '/v1/sets/10294-1': { success: true, set: { set_number: '10294-1', name: 'Titanic', quantity: 1 } },
    },
    { vorher: fenster => fenster.history.replaceState({}, '', '/?set=10294-1') },
  );
  try {
    assert.ok(
      await warte(() => aufrufe.some(a => a.url.includes('/v1/sets/10294-1'))),
      'Die Webapp liest ?set= nicht — der Knopf in der Mail öffnet nur die Startseite.',
    );
    assert.ok(
      await warte(
        () =>
          d.getElementById('set-modal').classList.contains('open') &&
          d.getElementById('m-tit').textContent.includes('Titanic'),
      ),
      'Das Set-Detail öffnet sich nicht.',
    );
    // Sonst reisst ein F5 das Detail erneut auf.
    assert.equal(w.location.search, '', 'Die Adresse wird nicht bereinigt');
  } finally {
    w.close();
  }
});
