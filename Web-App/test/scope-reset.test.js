/**
 * Account filter and storage location filter lie in localStorage; every login resets
 * them to „Alle“, a reload in the same session does not. Real
 * bundle in jsdom, household with a sub-account (otherwise the filter stays hidden).
 *
 * Counter-checks (measured 10.11.2026, each on its own, bundle rebuilt):
 *   A  the call resetScopeModes() removed in doLogin → red: “login
 *      resets …” (accounts=7 in the first set query)
 *   B  the loop removed in resetLagerModi() → red: same place (storage=…)
 *   C  setScopeMode() no longer stores → red: “the choice is remembered …”
 * Moving the call behind openApp() stays green: the loaders first wait
 * for the household, the reset runs through before.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt, ANMELDUNG } = require('./helpers/ui');

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
  bim_location_gallery: 'Regal A',
};
const remember = w => {
  for (const [k, v] of Object.entries(GEMERKT)) w.localStorage.setItem(k, v);
};
const setQueries = o => o.aufrufe.filter(a => a.method === 'GET' && /\/v1\/sets(\?|$)/.test(a.url));

test('login resets the account and location filters before the list loads', async () => {
  const o = await openUi(
    {
      ...ANMELDUNG,
      ...HAUSHALT,
      '/v1/auth/me': { success: true, loggedIn: false },
      '/v1/auth/login': {
        success: true,
        user: { id: 1, username: 'anna', is_admin: false, zweiterFaktorPflicht: false },
      },
    },
    { angemeldet: false, vorher: remember },
  );
  try {
    await warte(() => o.d.getElementById('login-screen').style.display === 'flex');
    assert.equal(setQueries(o).length, 0, 'vor der Anmeldung lädt nichts');
    o.d.getElementById('lu').value = 'anna';
    o.d.getElementById('lp').value = 'geheim-geheim';
    o.d.getElementById('btn-login').click();
    assert.ok(await warte(() => setQueries(o).length > 0), 'nach der Anmeldung lädt keine Setliste');
    await o.ruhig();
    const erste = setQueries(o)[0].url;
    assert.doesNotMatch(erste, /accounts=|storage=/, `die erste Setabfrage filtert noch: ${erste}`);
    for (const k of Object.keys(GEMERKT)) assert.equal(o.w.localStorage.getItem(k), null, `${k} blieb gespeichert`);
    assert.equal(o.d.getElementById('scope-gallery').value, 'all');
  } finally {
    o.w.close();
  }
});

test('a reload in the same session keeps the choice', async () => {
  const o = await openUi(HAUSHALT, { vorher: remember });
  try {
    await o.ruhig();
    assert.ok(
      setQueries(o).some(a => /accounts=7/.test(a.url) && /storage=Regal(\+|%20)A/.test(a.url)),
      setQueries(o)
        .map(a => a.url)
        .join('\n'),
    );
    assert.equal(o.w.localStorage.getItem('bim_scope_gallery'), '7');
    assert.equal(o.d.getElementById('scope-gallery').value, '7');
  } finally {
    o.w.close();
  }
});

test('the choice is remembered and goes to the server', async () => {
  const o = await openUi(HAUSHALT);
  try {
    await o.ruhig();
    const feld = o.d.getElementById('scope-gallery');
    assert.equal(feld.style.display, '', 'der Kontofilter ist bei einem Haushalt verborgen');
    feld.value = 'own';
    feld.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await takt(30);
    await o.ruhig();
    assert.equal(o.w.localStorage.getItem('bim_scope_gallery'), 'own');
    assert.match(setQueries(o).at(-1).url, /accounts=own/);
  } finally {
    o.w.close();
  }
});
