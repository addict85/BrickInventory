/**
 * UX review 12.11.2026, real bundle in jsdom: duration in the notation of the
 * language (“1,5 s”); year filter labeled as a year (“ab 2015”); a set without an
 * image has no zoom button; the menu stands in three groups, and the set detail
 * leads to price alerts and storage locations (the dialog closes in doing so).
 *
 * Counter-checks (measured 12.11.2026, each alone, bundle rebuilt):
 *   A  formatDuration again with toFixed(1) and “s” without space → red: “duration
 *      in the notation of the language” (“1.5s”)
 *   B  in katalog.js the year option again only with `${y}` → red: “year filter
 *      …” (“2016” instead of “ab 2016”)
 *   C  on #m-img again tabindex="0" role="button" data-click → red: “set without
 *      image …” (a tab stop before the first opening)
 *   D  in index.html role="group" of the account group removed → red: “menu in
 *      groups …”; in sichtAusDialog the click on the close button removed
 *      → red: “from the set detail …” (dialog stays open)
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
    // Since round 27 the image lies in a button; without an image it is disabled.
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
    // Account and settings say what they stand for.
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
