/**
 * UX-Prüfung 12.11.2026, echtes Bündel in jsdom: Dauer in der Schreibweise der
 * Sprache („1,5 s“); Jahresfilter als Jahr beschriftet („ab 2015“); ein Set ohne
 * Bild hat keinen Zoom-Knopf; das Menü steht in drei Gruppen, und das Set-Detail
 * führt zu Preisalarmen und Lagerorten (der Dialog schliesst dabei).
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  formatDuration wieder mit toFixed(1) und „s“ ohne Leerzeichen → rot: „Dauer
 *      in der Schreibweise der Sprache“ („1.5s“)
 *   B  in katalog.js die Jahresoption wieder nur mit `${y}` → rot: „Jahresfilter
 *      …“ („2016“ statt „ab 2016“)
 *   C  an #m-img wieder tabindex="0" role="button" data-click → rot: „Set ohne
 *      Bild …“ (vor dem ersten Öffnen ein Tab-Halt)
 *   D  in index.html role="group" der Kontogruppe entfernt → rot: „Menü in
 *      Gruppen …“; in sichtAusDialog den Klick auf den Schliessknopf entfernt
 *      → rot: „aus dem Set-Detail …“ (Dialog bleibt offen)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const MONITOR = lastDuration => ({
  '/v1/admin/job-status': {
    success: true,
    job: { running: false, lastRun: '2026-11-12T08:00:00Z', lastUpdated: 3, lastErrors: 0, lastDuration },
  },
  '/v1/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
  '/v1/admin/auftraege': {
    success: true,
    auftraege: [],
    zusammenfassung: [],
    job_prozess: { laeuft: true },
    bildbedarf: 0,
    pausen: [],
  },
});
const SET = {
  '/v1/sets': {
    success: true,
    total: 1,
    themes: [],
    sets: [{ set_number: '10300-1', name: 'Back to the Future', year: 2022, theme: 'Icons', quantity: 1 }],
  },
  '/v1/sets/10300-1': {
    success: true,
    set: { set_number: '10300-1', name: 'Back to the Future', year: 2022, quantity: 1 },
  },
  '/v1/sets/10300-1/acquisitions': { success: true, acquisitions: [] },
};

test("duration in the language's notation", async () => {
  for (const { sprache, browserLanguage, ms, erwartet } of [
    { sprache: 'de', browserLanguage: 'de-DE', ms: 1500, erwartet: /1,5 s/ },
    { sprache: 'de', browserLanguage: 'de-DE', ms: 125_000, erwartet: /2 min 5 s/ },
    { sprache: 'en', browserLanguage: 'en-US', ms: 1500, erwartet: /1\.5 s/ },
  ]) {
    const o = await openUi(MONITOR(ms), { sprache, browserLanguage });
    try {
      await reiter(o.w, 'monitor');
      const detail = () => text(o.d.getElementById('job-status-detail'));
      assert.ok(await warte(() => /3 /.test(detail())), `kein Laufbericht: ${detail()}`);
      assert.match(detail(), erwartet);
    } finally {
      o.w.close();
    }
  }
});

test('year filters say that it is about years', async () => {
  const o = await openUi({
    '/v1/catalog/meta': { success: true, themes: [], year_min: 2015, year_max: 2016, year_counts: [] },
  });
  try {
    await reiter(o.w, 'catalog');
    const optionen = id => [...o.d.getElementById(id).options].map(x => x.textContent.trim());
    assert.ok(await warte(() => optionen('cat-year-from').length === 3), optionen('cat-year-from').join());
    assert.deepEqual(optionen('cat-year-from'), ['Jahr ab…', 'ab 2016', 'ab 2015']);
    assert.deepEqual(optionen('cat-year-to'), ['Jahr bis…', 'bis 2016', 'bis 2015']);
  } finally {
    o.w.close();
  }
});

test('set without image: no button "enlarge image"', async () => {
  const o = await openUi(SET);
  try {
    const bild = o.d.getElementById('m-img');
    // Seit Runde 27 liegt das Bild in einem Knopf; ohne Bild ist der gesperrt.
    const knopf = /** @type {HTMLButtonElement} */ (bild.parentElement);
    const stand = () => ({
      role: bild.getAttribute('role'),
      tab: bild.tabIndex,
      klick: bild.dataset.click ?? knopf.dataset.click ?? null,
      gesperrt: knopf.disabled,
    });
    assert.deepEqual(stand(), { role: null, tab: -1, klick: null, gesperrt: true }, 'vor dem ersten Öffnen');
    await reiter(o.w, 'gallery');
    assert.ok(await warte(() => o.d.querySelector('#gallery [data-click="openModal"]')));
    o.d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => o.d.getElementById('set-modal').classList.contains('open')));
    assert.ok(await warte(() => /set-placeholder/.test(bild.getAttribute('src') || '')));
    assert.deepEqual(stand(), { role: null, tab: -1, klick: null, gesperrt: true }, 'mit Platzhalter');
  } finally {
    o.w.close();
  }
});

test('menu in groups with titles', async () => {
  const o = await openUi();
  try {
    const gruppen = [...o.d.querySelectorAll('#umenu-pop [role="group"]')].map(g => ({
      titel: text(o.d.getElementById(g.getAttribute('aria-labelledby'))),
      punkte: [...g.querySelectorAll('[role="menuitem"]')].map(b => b.dataset.arg),
    }));
    assert.deepEqual(gruppen, [
      { titel: 'Rund um die Sammlung', punkte: ['lagerorte', 'alarme', 'gutscheine'] },
      { titel: 'Mein Konto', punkte: ['profil', 'haushalt', 'daten', 'app'] },
      { titel: 'Verwaltung', punkte: ['settings', 'monitor'] },
    ]);
    // Konto und Einstellungen sagen, wofür sie stehen.
    assert.match(text(o.d.querySelector('[data-arg="profil"]')), /Profil, Design, Anmeldung/);
    assert.match(text(o.d.querySelector('[data-arg="settings"]')), /Für alle Konten/);
  } finally {
    o.w.close();
  }
});

test('from the set detail to price alerts and storage locations', async () => {
  const o = await openUi({
    ...SET,
    '/v1/alerts': { success: true },
    '/v1/storage/locations': { success: true },
    '/v1/storage': { success: true },
  });
  try {
    for (const ziel of ['alarme', 'lagerorte']) {
      await reiter(o.w, 'gallery');
      assert.ok(await warte(() => o.d.querySelector('#gallery [data-click="openModal"]')));
      o.d.querySelector('#gallery [data-click="openModal"]').click();
      const knopf = () => o.d.querySelector(`#set-modal [data-click="sichtAusDialog"][data-arg="${ziel}"]`);
      assert.ok(await warte(knopf), `kein Weg zu ${ziel}`);
      knopf().click();
      assert.ok(await warte(() => o.d.getElementById(`tab-${ziel}`).classList.contains('active')), ziel);
      assert.equal(o.d.getElementById('set-modal').classList.contains('open'), false, `${ziel}: Dialog offen`);
    }
  } finally {
    o.w.close();
  }
});
