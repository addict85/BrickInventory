/**
 * A notification leads to the set: the button in the mail carries `?set=` (alarm-mail-button.test.js
 * builds it), the web app uses it to open the set detail and cleans up the address. The app's
 * side (notification, entry, manifest) is checked by the Android suite (FremderEinstiegTest,
 * ManifestPruefenTest, tools/manifest-check.py).
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
      '/v2/sets/10294-1': { success: true, set: { set_number: '10294-1', name: 'Titanic', quantity: 1 } },
    },
    { before: fenster => fenster.history.replaceState({}, '', '/?set=10294-1') },
  );
  try {
    assert.ok(
      await warte(() => aufrufe.some(a => a.url.includes('/v2/sets/10294-1'))),
      'The web app does not read ?set= — the button in the mail only opens the start page.',
    );
    assert.ok(
      await warte(
        () =>
          d.getElementById('set-modal').classList.contains('open') &&
          d.getElementById('m-tit').textContent.includes('Titanic'),
      ),
      'The set detail does not open.',
    );
    // Otherwise an F5 tears the detail open again.
    assert.equal(w.location.search, '', 'The address is not cleaned up');
  } finally {
    w.close();
  }
});
