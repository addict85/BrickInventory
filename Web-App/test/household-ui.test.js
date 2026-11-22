/**
 * The household in the web app (real bundle in jsdom): inviting and redeeming for every account,
 * account selection and filter only with sub-accounts, owner badges only for another account,
 * and the filter per view, sent along and reloading only its own view.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  renderHousehold shows the redeem box only without parents → red “every account may invite and redeem”
 *   B  drawAccountSelection without the ap-owner entry → red “account selection … only in the household”
 *   C  initScopeSelects shows the filter for a single account too → red the same test (single account)
 *   D  ownerBadges without the check for the own account → red “owner badge only for another account”
 *   E  onScopeChange also emits collectionLoad for every view → red “the account filter …” (gallery reloaded)
 *   F  the finance tab loads pnl without scopeQuery('finance') → red the same test (pnl without the filter)
 *   (onScopeChange('parts') without loadManualParts() stays green: reloading the parts filters
 *   reloads the manual list as well.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, sicht, warte, takt } = require('./helpers/ui');

const ANNA = { id: 1, username: 'anna', is_self: true, depth: 0 };
const BEN = { id: 7, username: 'ben', is_self: false, depth: 1 };
const HOUSEHOLD = { '/v2/sets/household-members': { success: true, members: [ANNA, BEN] } };
const shown = (d, id) => d.getElementById(id)?.style.display !== 'none';
const OWNER_BOXES = ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner'];
const SCOPES = ['scope-gallery', 'scope-parts', 'scope-minifigs', 'scope-finance', 'scope-wanted'];

test('every account may invite and redeem — a sub-account too', async () => {
  const { w, d } = await openUi({
    '/v2/settings/household': {
      success: true,
      currency: 'EUR',
      sub_accounts: [],
      parents: [{ id: 9, username: 'mama' }],
    },
  });
  try {
    await sicht(w, 'household');
    assert.ok(await warte(() => /mama/.test(d.getElementById('household-state')?.textContent ?? '')));
    assert.deepEqual(
      ['household-invite-box', 'household-redeem-box'].map(id => shown(d, id)),
      [true, true],
    );
  } finally {
    w.close();
  }
});

test('account selection and account filter only in the household', async () => {
  const allein = await openUi();
  try {
    await allein.ruhig();
    assert.deepEqual(
      [...OWNER_BOXES.map(id => shown(allein.d, `${id}-box`)), ...SCOPES.map(id => shown(allein.d, id))],
      Array(9).fill(false),
      'single account',
    );
  } finally {
    allein.w.close();
  }
  const { w, d, ruhig } = await openUi(HOUSEHOLD);
  try {
    await ruhig();
    for (const id of OWNER_BOXES) {
      assert.ok(shown(d, `${id}-box`), `${id} hidden in the household`);
      assert.deepEqual(
        [...d.getElementById(id).options].map(o => o.value),
        ['1', '7'],
        id,
      );
    }
    for (const id of SCOPES) {
      assert.ok(shown(d, id), `${id} hidden in the household`);
      assert.deepEqual(
        [...d.getElementById(id).options].map(o => o.value),
        ['all', 'own', '7'],
        id,
      );
    }
  } finally {
    w.close();
  }
});

test('owner badge only for another account', async () => {
  const tile = (sn, owner) => ({ set_number: sn, name: sn, year: 2020, quantity: 1, owners: [owner] });
  const { w, d } = await openUi({
    ...HOUSEHOLD,
    '/v2/sets': {
      success: true,
      total: 2,
      themes: [],
      sets: [tile('10001-1', { id: 7, username: 'ben' }), tile('10002-1', { id: 1, username: 'anna' })],
    },
  });
  try {
    const badges = sn =>
      [
        ...(d.querySelector(`#gallery [data-price-for="${sn}"]`)?.closest('.sc')?.querySelectorAll('.owner-badge') ??
          []),
      ].map(b => b.textContent.trim());
    assert.ok(await warte(() => badges('10001-1').length > 0), 'no badge for the other account');
    assert.deepEqual(badges('10001-1'), ['ben']);
    assert.deepEqual(badges('10002-1'), [], 'the own account carries no badge');
  } finally {
    w.close();
  }
});

test('the account filter applies per view, is sent along and reloads only its view', async () => {
  const { w, d, aufrufe, ruhig } = await openUi(HOUSEHOLD);
  const pick = async (view, value) => {
    const el = d.getElementById(`scope-${view}`);
    el.value = value;
    const from = aufrufe.length;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
    await takt(50);
    await ruhig();
    return aufrufe.slice(from).map(a => a.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, ''));
  };
  const paths = urls => [...new Set(urls.map(u => u.split('?')[0]))].sort();
  try {
    await ruhig();
    await t_parts();
    await t_finance();
  } finally {
    w.close();
  }

  async function t_parts() {
    await reiter(w, 'parts');
    await ruhig();
    const urls = await pick('parts', '7');
    assert.equal(w.localStorage.getItem('bim_scope_parts'), '7');
    assert.equal(w.localStorage.getItem('bim_scope_gallery'), null, 'the gallery keeps its own choice');
    const lists = urls.filter(u => /^\/v2\/parts(\/manual)?\?/.test(u));
    assert.deepEqual(paths(lists), ['/v2/parts', '/v2/parts/manual'], urls.join('\n'));
    assert.ok(
      lists.every(u => new URL(u, 'http://x').searchParams.get('accounts') === '7'),
      lists.join('\n'),
    );
    assert.deepEqual(
      // The manual list prices itself via parts-valuation, in the filter of the parts view.
      urls.filter(u => /^\/v2\/(sets|minifigs|wanted)\b|^\/v2\/finance\/(?!parts-valuation\?accounts=7)/.test(u)),
      [],
      'other views reloaded',
    );
  }

  async function t_finance() {
    await reiter(w, 'finance');
    await ruhig();
    const urls = await pick('finance', '7');
    for (const ep of [
      '/v2/finance/valuation',
      '/v2/finance/parts-valuation',
      '/v2/finance/minifigs-valuation',
      '/v2/finance/pnl',
    ]) {
      const hit = urls.filter(u => u.split('?')[0] === ep);
      assert.ok(hit.length, `${ep} not reloaded:\n${urls.join('\n')}`);
      assert.ok(
        hit.every(u => new URL(u, 'http://x').searchParams.get('accounts') === '7'),
        `${ep} without the filter: ${hit.join(', ')}`,
      );
    }
    assert.deepEqual(
      urls.filter(u => /^\/v2\/(sets|parts|minifigs|wanted)\b/.test(u)),
      [],
      'other views reloaded',
    );
  }
});
