/**
 * A notification leads to the set: the button in the mail carries `?set=` (alarm-mail-button.test.js
 * builds it), the web app uses it to open the set detail and cleans up the address. The app's
 * side (notification, entry, manifest) is checked by the Android suite (FremderEinstiegTest,
 * ManifestPruefenTest, tools/manifest-pruefen.py).
 *
 * Counter-checks (10.11.2026, jsdom): reading ?set= removed in showApp() → red;
 * history.replaceState removed there → red (“not cleaned up”).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

test('4. and the web app redeems it', async () => {
  const { openUi, warte } = require('./helpers/ui');
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
    // Otherwise an F5 tears the detail open again.
    assert.equal(w.location.search, '', 'Die Adresse wird nicht bereinigt');
  } finally {
    w.close();
  }
});
