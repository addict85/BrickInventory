/**
 * Kontofilter und Lagerortfilter liegen im localStorage; jede Anmeldung setzt
 * sie auf „Alle“ zurück, ein Neuladen in derselben Sitzung nicht. Echtes
 * Bündel in jsdom, Haushalt mit Unterkonto (sonst bleibt der Filter verborgen).
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in doLogin den Aufruf resetScopeModes() entfernt → rot: „die Anmeldung
 *      setzt …“ (accounts=7 in der ersten Setabfrage)
 *   B  in resetLagerModi() die Schleife entfernt → rot: ebenda (storage=…)
 *   C  setScopeMode() speichert nicht mehr → rot: „die Wahl wird gemerkt …“
 * Den Aufruf hinter oeffneApp() zu schieben bleibt grün: Die Lader warten
 * zuerst auf den Haushalt, das Zurücksetzen läuft vorher durch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt, ANMELDUNG } = require('./helpers/oberflaeche');

const HAUSHALT = {
  '/v1/sets/household-members': {
    success: true,
    members: [
      { id: 1, username: 'anna', is_self: true, tiefe: 0 },
      { id: 7, username: 'ben', is_self: false, tiefe: 1 },
    ],
  },
};
const GEMERKT = {
  bim_scope_gallery: '7',
  bim_scope_parts: 'own',
  bim_scope_finance: '7',
  bim_lager_gallery: 'Regal A',
};
const merke = w => {
  for (const [k, v] of Object.entries(GEMERKT)) w.localStorage.setItem(k, v);
};
const setAbfragen = o => o.aufrufe.filter(a => a.method === 'GET' && /\/v1\/sets(\?|$)/.test(a.url));

test('die Anmeldung setzt Konto- und Lagerortfilter zurück, bevor die Liste lädt', async () => {
  const o = await oeffneOberflaeche(
    {
      ...ANMELDUNG,
      ...HAUSHALT,
      '/v1/auth/me': { success: true, loggedIn: false },
      '/v1/auth/login': {
        success: true,
        user: { id: 1, username: 'anna', is_admin: false, zweiterFaktorPflicht: false },
      },
    },
    { angemeldet: false, vorher: merke },
  );
  try {
    await warte(() => o.d.getElementById('login-screen').style.display === 'flex');
    assert.equal(setAbfragen(o).length, 0, 'vor der Anmeldung lädt nichts');
    o.d.getElementById('lu').value = 'anna';
    o.d.getElementById('lp').value = 'geheim-geheim';
    o.d.getElementById('btn-login').click();
    assert.ok(await warte(() => setAbfragen(o).length > 0), 'nach der Anmeldung lädt keine Setliste');
    await o.ruhig();
    const erste = setAbfragen(o)[0].url;
    assert.doesNotMatch(erste, /accounts=|storage=/, `die erste Setabfrage filtert noch: ${erste}`);
    for (const k of Object.keys(GEMERKT)) assert.equal(o.w.localStorage.getItem(k), null, `${k} blieb gespeichert`);
    assert.equal(o.d.getElementById('scope-gallery').value, 'all');
  } finally {
    o.w.close();
  }
});

test('ein Neuladen in derselben Sitzung behält die Wahl', async () => {
  const o = await oeffneOberflaeche(HAUSHALT, { vorher: merke });
  try {
    await o.ruhig();
    assert.ok(
      setAbfragen(o).some(a => /accounts=7/.test(a.url) && /storage=Regal(\+|%20)A/.test(a.url)),
      setAbfragen(o)
        .map(a => a.url)
        .join('\n'),
    );
    assert.equal(o.w.localStorage.getItem('bim_scope_gallery'), '7');
    assert.equal(o.d.getElementById('scope-gallery').value, '7');
  } finally {
    o.w.close();
  }
});

test('die Wahl wird gemerkt und geht an den Server', async () => {
  const o = await oeffneOberflaeche(HAUSHALT);
  try {
    await o.ruhig();
    const feld = o.d.getElementById('scope-gallery');
    assert.equal(feld.style.display, '', 'der Kontofilter ist bei einem Haushalt verborgen');
    feld.value = 'own';
    feld.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await takt(30);
    await o.ruhig();
    assert.equal(o.w.localStorage.getItem('bim_scope_gallery'), 'own');
    assert.match(setAbfragen(o).at(-1).url, /accounts=own/);
  } finally {
    o.w.close();
  }
});
