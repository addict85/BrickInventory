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
const { openUi, waitFor, tick } = require('./helpers/ui');

test('without server: hint and try again', async () => {
  const state = { route: true };
  const o = await openUi(
    {
      '/v2/startup-status': () => {
        if (state.route) throw new TypeError('Failed to fetch');
        return { ready: true };
      },
      '/v2/auth/me': { loggedIn: false },
    },
    { loggedIn: false, browserLanguage: 'de-DE' },
  );
  try {
    const hint = o.d.getElementById('start-offline');
    assert.ok(hint.hidden, 'not right at the first failure');
    assert.ok(await waitFor(() => !hint.hidden, 8000), 'no hint after 8 s');
    assert.match(hint.textContent, /nicht erreichbar/);
    assert.equal(hint.getAttribute('role'), 'alert');
    const button = o.d.getElementById('start-again');
    assert.match(button.textContent, /Erneut versuchen/);

    state.route = false;
    const prior = o.calls.length;
    button.click();
    // The normal tick after an error is two seconds; the button must be faster.
    assert.ok(
      await waitFor(() => o.d.getElementById('login-screen').style.display === 'flex', 500),
      'Button does not catch up on the startup immediately',
    );
    assert.ok(o.calls.length > prior);
    assert.ok(hint.hidden, 'Hint stays after the startup');
    await tick(10);
  } finally {
    o.w.close();
  }
});
