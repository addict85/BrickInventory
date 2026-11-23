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
 *      groups …”; in viewFromDialog the click on the close button removed
 *      → red: “from the set detail …” (dialog stays open)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const MONITOR = lastDuration => ({
  '/v2/admin/job-status': {
    success: true,
    job: { running: false, lastRun: '2026-11-12T08:00:00Z', lastUpdated: 3, lastErrors: 0, lastDuration },
  },
  '/v2/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
  '/v2/admin/job-queue': {
    success: true,
    jobs: [],
    summary: [],
    job_process: { running: true },
    image_demand: 0,
    pauses: [],
  },
});
const SET = {
  '/v2/sets': {
    success: true,
    total: 1,
    themes: [],
    sets: [{ set_number: '10300-1', name: 'Back to the Future', year: 2022, theme: 'Icons', quantity: 1 }],
  },
  '/v2/sets/10300-1': {
    success: true,
    set: { set_number: '10300-1', name: 'Back to the Future', year: 2022, quantity: 1 },
  },
  '/v2/sets/10300-1/acquisitions': { success: true, acquisitions: [] },
};

test("duration in the language's notation", async () => {
  for (const { language, browserLanguage, ms, expected } of [
    { language: 'de', browserLanguage: 'de-DE', ms: 1500, expected: /1,5 s/ },
    { language: 'de', browserLanguage: 'de-DE', ms: 125_000, expected: /2 min 5 s/ },
    { language: 'en', browserLanguage: 'en-US', ms: 1500, expected: /1\.5 s/ },
  ]) {
    const o = await openUi(MONITOR(ms), { language, browserLanguage });
    try {
      await switchTab(o.w, 'monitor');
      const detail = () => text(o.d.getElementById('job-status-detail'));
      assert.ok(await waitFor(() => /3 /.test(detail())), `no run report: ${detail()}`);
      assert.match(detail(), expected);
    } finally {
      o.w.close();
    }
  }
});

test('year filters say that it is about years', async () => {
  const o = await openUi({
    '/v2/catalog/meta': { success: true, themes: [], year_min: 2015, year_max: 2016, year_counts: [] },
  });
  try {
    await switchTab(o.w, 'catalog');
    const options = id => [...o.d.getElementById(id).options].map(x => x.textContent.trim());
    assert.ok(await waitFor(() => options('cat-year-from').length === 3), options('cat-year-from').join());
    assert.deepEqual(options('cat-year-from'), ['Jahr ab…', 'ab 2016', 'ab 2015']);
    assert.deepEqual(options('cat-year-to'), ['Jahr bis…', 'bis 2016', 'bis 2015']);
  } finally {
    o.w.close();
  }
});

test('set without image: no button "enlarge image"', async () => {
  const o = await openUi(SET);
  try {
    const image = o.d.getElementById('m-img');
    // Since round 27 the image lies in a button; without an image it is disabled.
    const button = /** @type {HTMLButtonElement} */ (image.parentElement);
    const state = () => ({
      role: image.getAttribute('role'),
      tab: image.tabIndex,
      klick: image.dataset.click ?? button.dataset.click ?? null,
      locked: button.disabled,
    });
    assert.deepEqual(state(), { role: null, tab: -1, klick: null, locked: true }, 'before the first opening');
    await switchTab(o.w, 'gallery');
    assert.ok(await waitFor(() => o.d.querySelector('#gallery [data-click="openModal"]')));
    o.d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await waitFor(() => o.d.getElementById('set-modal').classList.contains('open')));
    assert.ok(await waitFor(() => /set-placeholder/.test(image.getAttribute('src') || '')));
    assert.deepEqual(state(), { role: null, tab: -1, klick: null, locked: true }, 'with a placeholder');
  } finally {
    o.w.close();
  }
});

test('menu in groups with titles', async () => {
  const o = await openUi();
  try {
    const groups = [...o.d.querySelectorAll('#umenu-pop [role="group"]')].map(g => ({
      title: text(o.d.getElementById(g.getAttribute('aria-labelledby'))),
      points: [...g.querySelectorAll('[role="menuitem"]')].map(b => b.dataset.arg),
    }));
    assert.deepEqual(groups, [
      { title: 'Rund um die Sammlung', points: ['locations', 'alerts', 'vouchers'] },
      { title: 'Mein Konto', points: ['profile', 'household', 'data', 'app'] },
      { title: 'Verwaltung', points: ['settings', 'monitor'] },
    ]);
    // Account and settings say what they stand for.
    assert.match(text(o.d.querySelector('[data-arg="profile"]')), /Profil, Design, Anmeldung/);
    assert.match(text(o.d.querySelector('[data-arg="settings"]')), /Für alle Konten/);
  } finally {
    o.w.close();
  }
});

test('from the set detail to price alerts and storage locations', async () => {
  const o = await openUi({
    ...SET,
    '/v2/alerts': { success: true },
    '/v2/storage/locations': { success: true },
    '/v2/storage': { success: true },
  });
  try {
    for (const target of ['alerts', 'locations']) {
      await switchTab(o.w, 'gallery');
      assert.ok(await waitFor(() => o.d.querySelector('#gallery [data-click="openModal"]')));
      o.d.querySelector('#gallery [data-click="openModal"]').click();
      const button = () => o.d.querySelector(`#set-modal [data-click="viewFromDialog"][data-arg="${target}"]`);
      assert.ok(await waitFor(button), `no way to ${target}`);
      button().click();
      assert.ok(await waitFor(() => o.d.getElementById(`tab-${target}`).classList.contains('active')), target);
      assert.equal(o.d.getElementById('set-modal').classList.contains('open'), false, `${target}: dialog open`);
    }
  } finally {
    o.w.close();
  }
});
