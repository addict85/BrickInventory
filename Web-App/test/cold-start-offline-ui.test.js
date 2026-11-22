/**
 * Cold start without server (UI review 17, flows M18), real bundle in
 * jsdom: if /api does not answer, after at most eight seconds “server
 * not reachable” appears with a button “try again”. When the server is
 * back, the button catches up on the start immediately, and the hint disappears.
 *
 * Counter-checks (measured 05.11.2026, each alone, bundle rebuilt):
 *   A  in waitForStartup the call zeigeOffline(true) removed → red: “without
 *      server” (no hint after 8 s)
 *   B  knopf.onclick not set → red: “without server” (the login only came
 *      with the next tick, not immediately)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt } = require('./helpers/ui');

test('without server: hint and try again', async () => {
  const stand = { weg: true };
  const o = await openUi(
    {
      '/v1/startup-status': () => {
        if (stand.weg) throw new TypeError('Failed to fetch');
        return { ready: true };
      },
      '/v1/auth/me': { loggedIn: false },
    },
    { loggedIn: false, browserLanguage: 'de-DE' },
  );
  try {
    const hinweis = o.d.getElementById('start-offline');
    assert.ok(hinweis.hidden, 'nicht gleich beim ersten Fehlschlag');
    assert.ok(await warte(() => !hinweis.hidden, 8000), 'nach 8 s kein Hinweis');
    assert.match(hinweis.textContent, /nicht erreichbar/);
    assert.equal(hinweis.getAttribute('role'), 'alert');
    const knopf = o.d.getElementById('start-again');
    assert.match(knopf.textContent, /Erneut versuchen/);

    stand.weg = false;
    const vorher = o.aufrufe.length;
    knopf.click();
    // The normal tick after an error is two seconds; the button must be faster.
    assert.ok(
      await warte(() => o.d.getElementById('login-screen').style.display === 'flex', 500),
      'Knopf holt den Start nicht sofort nach',
    );
    assert.ok(o.aufrufe.length > vorher);
    assert.ok(hinweis.hidden, 'Hinweis bleibt nach dem Start stehen');
    await takt(10);
  } finally {
    o.w.close();
  }
});
