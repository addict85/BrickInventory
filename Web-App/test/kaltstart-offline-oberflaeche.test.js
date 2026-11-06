/**
 * Kaltstart ohne Server (UI-Prüfung 17, Abläufe M18), echtes Bündel in
 * jsdom: Antwortet /api nicht, steht nach höchstens acht Sekunden „Server
 * nicht erreichbar“ mit einem Knopf „Erneut versuchen“ da. Ist der Server
 * zurück, holt der Knopf den Start sofort nach, und der Hinweis verschwindet.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in waitForStartup den Aufruf zeigeOffline(true) entfernt → rot: „ohne
 *      Server“ (kein Hinweis nach 8 s)
 *   B  knopf.onclick nicht gesetzt → rot: „ohne Server“ (die Anmeldung kam
 *      erst mit dem nächsten Takt, nicht sofort)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt } = require('./helpers/oberflaeche');

test('ohne Server: Hinweis und Erneut versuchen', async () => {
  const stand = { weg: true };
  const o = await oeffneOberflaeche(
    {
      '/v1/startup-status': () => {
        if (stand.weg) throw new TypeError('Failed to fetch');
        return { ready: true };
      },
      '/v1/auth/me': { loggedIn: false },
    },
    { angemeldet: false, browserSprache: 'de-DE' },
  );
  try {
    const hinweis = o.d.getElementById('start-offline');
    assert.ok(hinweis.hidden, 'nicht gleich beim ersten Fehlschlag');
    assert.ok(await warte(() => !hinweis.hidden, 8000), 'nach 8 s kein Hinweis');
    assert.match(hinweis.textContent, /nicht erreichbar/);
    assert.equal(hinweis.getAttribute('role'), 'alert');
    const knopf = o.d.getElementById('start-erneut');
    assert.match(knopf.textContent, /Erneut versuchen/);

    stand.weg = false;
    const vorher = o.aufrufe.length;
    knopf.click();
    // Der normale Takt nach einem Fehler sind zwei Sekunden; der Knopf muss schneller sein.
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
