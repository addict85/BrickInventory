/**
 * Small findings of UI review 17 (flows N2–N6, N9, N10, N12, N16, N20,
 * N22, N26), real bundle in jsdom or the server function:
 *   - An already existing set shows exactly one button “open set” in the add dialog
 *     (N2).
 *   - Key figures: “1.565 verschiedene” with separators; en shows 10828 as
 *     a whole number, not “10.8K” (N3, N4).
 *   - The page title has no soft hyphens (N5).
 *   - An administrator named “admin” is not called “admin
 *     (Administrator)” in the header (N6).
 *   - Log times stand as 05.11.2026 (N9).
 *   - Saving empty credentials reports “access removed” (N10).
 *   - The recovery codes: “I have saved the codes” and “save as
 *     file” (N12).
 *   - Minifigures: “bought on” on the card, total count as the first key figure
 *     (N16).
 *   - Remembering an existing set names the collection (N20).
 *   - With a sub-account and “all accounts” the gallery subtitle says
 *     “in the household” (N22; since UI review 22 the title stays fixed).
 *   - The login mask names the version instead of a fixed date (N26).
 *
 * Counter-checks (measured 05.11.2026, each alone, bundle rebuilt):
 *   A  fmtBig short again from 10000 → red: “key figures with separators”
 *   B  in showPageName the replace(/­/) removed → red: “title without
 *      soft hyphens”
 *   C  in showUsernames the name check removed → red: “admin without
 *      (Administrator)”; only `name === 'admin' ||` removed (16.11.2026) → red: same place (en)
 *   D  in the log again toLocaleString → red: “log with fmtDate”
 *   E  speichereZugang always reports okText → red: “empty credentials”
 *   F  in setUnbekannt the second button back → red: “one button open
 *      set”
 *   G  merkMeldung without querying the collection → red: “remembering names the
 *      collection”
 *   H  collectionSubtitle() not called in initScopeSelects → red:
 *      “household in the subtitle” (13.11.2026)
 *   I  insertVersion() returns the HTML unchanged → red: “version in
 *      the login mask”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, waitFor, tick, switchTab } = require('./helpers/ui');

test('metrics with separators, complete in English too', async () => {
  const stats = {
    '/v2/stats': {
      success: true,
      stats: { total_sets: 1565, total_quantity: 3095, total_parts: 10828, total_minifigs: 19, total_instructions: 0 },
    },
  };
  const de = await openUi(stats, { browserLanguage: 'de-DE' });
  try {
    assert.ok(
      await waitFor(() => /1\.565 verschiedene/.test(de.d.getElementById('tab-gallery').textContent)),
      de.d.querySelector('#bstat-sets')?.parentElement?.textContent,
    );
  } finally {
    de.w.close();
  }
  const en = await openUi(stats, { language: 'en', browserLanguage: 'en-US' });
  try {
    assert.ok(await waitFor(() => en.d.getElementById('bstat-parts').textContent !== '—'));
    assert.equal(en.d.getElementById('bstat-parts').textContent, '10,828');
  } finally {
    en.w.close();
  }
  // British like “catalogue” (review 21): the values write “colour”, the keys stay.
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', 'en.js'), 'utf8'),
    /:\s*'[^']*\bcolor/i,
  );
});

test('title without soft hyphens', async () => {
  const o = await openUi(
    {
      '/v2/admin/job-status': { success: true, job: { running: false } },
      '/v2/admin/jobs': { success: true, jobs: {}, schedules: {}, db: { csvCache: {}, blMapping: {} } },
      '/v2/admin/job-queue': {
        success: true,
        jobs: [],
        summary: [],
        job_process: { running: true },
        image_demand: 0,
        pauses: [],
      },
    },
    { browserLanguage: 'de-DE' },
  );
  try {
    await switchTab(o.w, 'monitor');
    assert.ok(await waitFor(() => /Hintergrund/.test(o.d.title), 2000), o.d.title);
    assert.doesNotMatch(o.d.title, /­/);
  } finally {
    o.w.close();
  }
});

test('admin without (Administrator)', async () => {
  for (const [username, language] of [
    ['admin', 'en'],
    ['admin', 'de'],
    ['Administrator', 'de'],
  ]) {
    const o = await openUi(
      { '/v2/auth/me': { loggedIn: true, user: { id: 1, username, is_admin: true } } },
      language === 'en' ? { language: 'en', browserLanguage: 'en-US' } : {},
    );
    try {
      assert.ok(await waitFor(() => o.d.getElementById('ubadge').textContent.trim()));
      assert.equal(o.d.getElementById('ubadge').textContent, username, language);
    } finally {
      o.w.close();
    }
  }
});

test('log with fmtDate', async () => {
  const o = await openUi(
    {
      '/v2/admin/audit-log': {
        success: true,
        entries: [
          {
            occurred_at: '2026-11-05T17:29:38Z',
            admin_name: 'anna',
            action: 'account_created',
            target_name: 'bert',
          },
        ],
      },
    },
    { browserLanguage: 'de-DE' },
  );
  try {
    await switchTab(o.w, 'settings');
    assert.ok(await waitFor(() => o.d.querySelector('#vw-log tbody td')));
    assert.match(o.d.querySelector('#vw-log tbody td').textContent, /^\d{2}\.\d{2}\.\d{4}/);
  } finally {
    o.w.close();
  }
});

test('empty credentials report "access removed"', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    o.d.getElementById('rb-key').value = '';
    o.d.getElementById('btn-sav-rb').click();
    // Confirmation happens at the button (reportAtField), not in the toast.
    const state = () => o.d.querySelector('#settings-rb .field-status')?.textContent || '';
    assert.ok(await waitFor(() => /Zugang entfernt/.test(state()), 2000), state());
    assert.doesNotMatch(state() + o.d.getElementById('toasts').textContent, /gespeichert/i);
  } finally {
    o.w.close();
  }
});

test('recovery codes: saved and as a file', async () => {
  const o = await openUi(
    { '/v2/auth/second-factor/confirm': { success: true, codes: ['aaaa-bbbb', 'cccc-dddd'] } },
    { browserLanguage: 'de-DE' },
  );
  try {
    o.w.URL.createObjectURL = () => 'blob:probe';
    o.w.URL.revokeObjectURL = () => {};
    const field = o.d.createElement('input');
    field.id = 'sf-code';
    field.value = '123456';
    const button = o.d.createElement('button');
    button.dataset.click = 'confirmSecondFactor';
    o.d.getElementById('zf-bereich')?.append(field, button) ?? o.d.body.append(field, button);
    button.click();
    assert.ok(await waitFor(() => o.d.getElementById('sf-saved')));
    assert.match(o.d.getElementById('sf-saved').textContent, /gesichert/);
    const file = o.d.querySelector('[data-click="saveRecoveryCodes"]');
    assert.ok(file, 'no button „Als Datei speichern“');
    let loaded = '';
    o.w.HTMLAnchorElement.prototype.click = function () {
      loaded = this.download;
    };
    file.click();
    assert.match(loaded, /\.txt$/);
  } finally {
    o.w.close();
  }
});

test('minifigures: bought on and total first', async () => {
  const o = await openUi(
    {
      '/v2/minifigs': {
        success: true,
        total: 1,
        figs: [
          {
            fig_number: 'fig-000001',
            fig_name: 'Ritter',
            quantity: 2,
            source: 'set',
            set_added_at: '2026-03-04T12:00:00Z',
          },
        ],
      },
    },
    { browserLanguage: 'de-DE' },
  );
  try {
    await switchTab(o.w, 'minifigs');
    const first = o.d.querySelector('#tab-minifigs .brick-stats .bstat .bstat-l');
    assert.equal(first.textContent.trim(), 'Figuren gesamt');
    assert.ok(
      await waitFor(() => /Gekauft am 04\.03\.2026/.test(o.d.getElementById('tab-minifigs').textContent), 2000),
    );
  } finally {
    o.w.close();
  }
});

test('a button "open set" for an existing set', async () => {
  const o = await openUi(
    { '/v2/sets/10305-1': { success: true, set: { set_number: '10305-1', name: 'Burg', quantity: 2 } } },
    { browserLanguage: 'de-DE' },
  );
  try {
    o.d.querySelector('[data-click="openCapture"][data-arg="set"]').click();
    await tick(10);
    o.d.getElementById('add-num').value = '10305-1';
    o.d.getElementById('btn-add').click();
    assert.ok(await waitFor(() => !o.d.getElementById('add-unknown').hidden));
    const buttonList = [...o.d.querySelectorAll('#add-set-modal button')].filter(b => /Set öffnen/.test(b.textContent));
    assert.equal(buttonList.length, 1);
  } finally {
    o.w.close();
  }
});

test('remember names the collection', async () => {
  const o = await openUi(
    {
      '/v2/wanted': (_u, opt) =>
        opt?.method === 'POST' ? { success: true, was_new: true } : { success: true, items: [] },
      '/v2/sets/10305-1': { success: true, set: { set_number: '10305-1', name: 'Burg', quantity: 3 } },
    },
    { browserLanguage: 'de-DE' },
  );
  try {
    o.d.getElementById('mk-num').value = '10305-1';
    const button = o.d.createElement('button');
    button.dataset.click = 'addWantedItem';
    o.d.body.append(button);
    button.click();
    assert.ok(
      await waitFor(() => /Sammlung \(×3\)/.test(o.d.getElementById('toasts').textContent), 2000),
      o.d.getElementById('toasts').textContent,
    );
  } finally {
    o.w.close();
  }
});

test('household in the subtitle', async () => {
  const o = await openUi(
    {
      '/v2/sets/household-members': {
        success: true,
        members: [
          { id: 1, username: 'anna', is_self: true, depth: 0 },
          { id: 2, username: 'ben', is_self: false, depth: 1 },
        ],
      },
    },
    { browserLanguage: 'de-DE' },
  );
  try {
    assert.ok(await waitFor(() => o.d.getElementById('scope-gallery').style.display !== 'none'));
    o.w.eval('document.querySelector(\'.ntab[data-tab="gallery"]\').click()');
    assert.ok(
      await waitFor(() => /im Haushalt/.test(o.d.getElementById('gallery-sub').textContent), 2000),
      o.d.getElementById('gallery-sub').textContent,
    );
    const choice = o.d.getElementById('scope-gallery');
    choice.value = 'own';
    choice.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    assert.ok(
      await waitFor(() => /^Alle Sets deiner Sammlung/.test(o.d.getElementById('gallery-sub').textContent), 2000),
    );
  } finally {
    o.w.close();
  }
});

test('version in the login mask', () => {
  const { insertVersion } = require('./helpers/sources').buildAndRequire()('src/profile/indexHtml.js');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Build 20\d\d\./, 'fixed date in index.html');
  assert.match(insertVersion(html, 'ab341de'), /<div class="start-footer" data-version>Version ab341de<\/div>/);
  assert.match(insertVersion(html, 'unbekannt'), /<div class="start-footer" data-version><\/div>/);
  assert.doesNotMatch(insertVersion(html, '<b>x'), /<b>/);
});
