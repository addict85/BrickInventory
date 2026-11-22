/**
 * If the Rebrickable key is missing, the admin still opens his
 * collection. A banner points it out, leads to the field on request and can be
 * dismissed permanently per account. On the real bundle in jsdom.
 *
 * Counter-checks (measured 02.11.2026, each on its own, bundle rebuilt):
 *   A  in checkRbKey again the jump to the tab „settings“ → red:
 *      “collection instead of settings”
 *   B  showRbHint() not called → red: “banner appears”
 *   C  localStorage check removed in showRbHint → red: “dismissed
 *      it stays away” (03.11.2026: deadline set to 30 days → red: “after
 *      30 days it comes back”)
 *   D  openRbHint without a click on the section → red: “link leads to the field”
 *   E  setupLater without showRbHint() → red: “after “Später” in the
 *      wizard the banner appears”
 *   F  (12.11.2026, UX check 19 M4: permanently per account) key again
 *      without account → red: “another account sees it again”; with a deadline of
 *      30 days → red: “even after 31 days it stays away”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt } = require('./helpers/ui');

const WITHOUT_KEY = {
  '/v2/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: '' } },
  '/v2/sets': {
    success: true,
    total: 1,
    themes: [],
    sets: [{ set_number: '10294-1', name: 'Titanic', year: 2021, theme: 'Icons', num_parts: 9090, quantity: 1 }],
  },
};

test('without a Rebrickable key: collection with hint banner', async t => {
  const { w, d, aufrufe } = await openUi(WITHOUT_KEY);
  try {
    const band = d.getElementById('rb-hint');
    await warte(() => !band.hidden, 2000);
    await t.test('banner appears', () => {
      assert.equal(band.hidden, false);
      assert.match(band.textContent, /Rebrickable/);
    });
    await t.test('collection instead of settings', async () => {
      await takt(50);
      assert.equal(d.getElementById('tab-gallery').classList.contains('active'), true);
      assert.equal(d.getElementById('tab-settings').classList.contains('active'), false);
      assert.ok(
        aufrufe.some(a => /\/v2\/sets(\?|$)/.test(a.url)),
        'collection not loaded',
      );
    });
    await t.test('link leads to the field', async () => {
      band.querySelector('[data-click="openRbHint"]').click();
      await takt(50);
      assert.equal(d.getElementById('tab-settings').classList.contains('active'), true);
      assert.equal(d.getElementById('settings-rb').classList.contains('settings-active'), true);
      assert.equal(d.activeElement.id, 'rb-key');
      assert.equal(band.hidden, true);
    });
  } finally {
    w.close();
  }
});

test('dismissed it stays away — even in a new session', async () => {
  const erst = await openUi(WITHOUT_KEY);
  let gemerkt;
  try {
    const band = erst.d.getElementById('rb-hint');
    await warte(() => !band.hidden, 2000);
    band.querySelector('[data-click="dismissRbHint"]').click();
    assert.equal(band.hidden, true);
    gemerkt = Object.keys(erst.w.localStorage).find(k => k.startsWith('bim_rb_hint_dismissed:'));
    assert.ok(gemerkt, 'nothing remembered in localStorage');
  } finally {
    erst.w.close();
  }
  const zweit = await openUi(WITHOUT_KEY, {
    before: w => w.localStorage.setItem(gemerkt, '1'),
  });
  try {
    assert.ok(await zweit.ruhig());
    assert.equal(zweit.d.getElementById('rb-hint').hidden, true);
  } finally {
    zweit.w.close();
  }
});

test('even after 31 days it stays away, another account sees it again', async t => {
  const erst = await openUi(WITHOUT_KEY);
  let schluessel;
  try {
    await warte(() => !erst.d.getElementById('rb-hint').hidden, 2000);
    erst.d.querySelector('#rb-hint [data-click="dismissRbHint"]').click();
    schluessel = Object.keys(erst.w.localStorage).find(k => k.startsWith('bim_rb_hint_dismissed:'));
  } finally {
    erst.w.close();
  }
  await t.test('even after 31 days it stays away', async () => {
    const before31 = Date.now() - 31 * 24 * 3600 * 1000;
    const { w, d, ruhig } = await openUi(WITHOUT_KEY, {
      before: f => {
        f.localStorage.setItem(schluessel, String(before31));
        f.Date.now = () => before31 + 62 * 24 * 3600 * 1000;
      },
    });
    try {
      assert.ok(await ruhig());
      assert.equal(d.getElementById('rb-hint').hidden, true);
    } finally {
      w.close();
    }
  });
  await t.test('another account sees it again', async () => {
    const { w, d } = await openUi(
      {
        ...WITHOUT_KEY,
        '/v2/auth/me': {
          success: true,
          loggedIn: true,
          user: { id: 2, username: 'bert', is_admin: true, secondFactorRequired: false },
        },
      },
      { before: f => f.localStorage.setItem(schluessel, '1') },
    );
    try {
      await warte(() => !d.getElementById('rb-hint').hidden, 2000);
      assert.equal(d.getElementById('rb-hint').hidden, false);
    } finally {
      w.close();
    }
  });
});

test('after “Später” in the wizard the banner appears', async () => {
  const { w, d, ruhig } = await openUi({
    ...WITHOUT_KEY,
    '/v2/settings/setup': {
      success: true,
      open: true,
      change_password: false,
      sources: { rebrickable: false },
    },
  });
  try {
    await warte(() => d.getElementById('setup-modal').classList.contains('open'));
    assert.ok(await ruhig());
    assert.equal(d.getElementById('rb-hint').hidden, true, 'band above the wizard');
    d.querySelector('#setup-modal [data-click="setupLater"]').click();
    await takt(20);
    assert.equal(d.getElementById('rb-hint').hidden, false);
  } finally {
    w.close();
  }
});

test('with a key no banner', async () => {
  const { w, d, ruhig } = await openUi();
  try {
    assert.ok(await ruhig());
    assert.equal(d.getElementById('rb-hint').hidden, true);
  } finally {
    w.close();
  }
});
