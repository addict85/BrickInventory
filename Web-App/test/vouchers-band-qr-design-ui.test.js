/**
 * Smaller findings of the UI check of 02.11.2026, on the real bundle in jsdom
 * (with styles.css where visibility matters):
 *   - voucher row: „kein PDF“ stands there visibly, delete is a button
 *     like its neighbors with a name; without vouchers no sum, no …
 *
 * Counter-checks (measured 02.11.2026, each on its own):
 *   A  voucher-nopdf again only „—“ with .vh text → red: “vouchers …”
 *   B  the hiding of [data-only-with-vouchers] removed in loadVouchers()
 *      → red: “without vouchers …”
 *   C  rule body:not(:has(…)) #rb-hint removed → red: “Rebrickable banner …”
 *   D  #qr-code:empty rule removed → red: “QR area …”
 *   E  showSettingAccess() not called → red: „Kein Zugriff …“
 *   F  description left out (only werkbank hint) → red: “design …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi, switchTab, view, waitFor, tick } = require('./helpers/ui');

const STYLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const withStyle = w =>
  w.document.addEventListener('DOMContentLoaded', () => {
    const s = w.document.createElement('style');
    s.textContent = STYLE;
    w.document.head.append(s);
  });
const closed = (w, e) => {
  for (let x = e; x && x.nodeType === 1; x = x.parentElement) if (w.getComputedStyle(x).display === 'none') return true;
  return false;
};

const VOUCHER = {
  id: 3,
  number: '6123456789012',
  pin: '4711',
  amount: 50,
  currency: 'CHF',
  has_pdf: false,
  balance_checked_at: null,
};

test('vouchers: row and actions', async () => {
  const o = await openUi({ '/v2/vouchers': { success: true, vouchers: [VOUCHER] } }, { before: withStyle });
  try {
    await view(o.w, 'vouchers');
    await waitFor(() => o.d.querySelector('.voucher-row'));
    const row = o.d.querySelector('.voucher-row');
    assert.match(row.querySelector('.voucher-nopdf').textContent.trim(), /^kein PDF$/);
    const remove = row.querySelector('[data-click="deleteVoucher"]');
    const edit = row.querySelector('[data-click="editVoucher"]');
    // Both labeled (UI check 6, M7), delete marked as danger.
    assert.equal(remove.className, edit.className + ' v-btn-danger');
    assert.deepEqual([edit.textContent.trim(), remove.textContent.trim()], ['Bearbeiten', 'Löschen']);
    for (const e of o.d.querySelectorAll('[data-only-with-vouchers]')) assert.equal(closed(o.w, e), false);
  } finally {
    o.w.close();
  }
});

test('without vouchers: no sum, no “query all”, no export', async () => {
  const o = await openUi({ '/v2/vouchers': { success: true, vouchers: [] } }, { before: withStyle });
  try {
    await view(o.w, 'vouchers');
    await waitFor(() => o.d.querySelector('.voucher-empty'));
    const parts = [...o.d.querySelectorAll('[data-only-with-vouchers]')];
    assert.equal(parts.length, 3);
    assert.deepEqual(
      parts.map(e => closed(o.w, e)),
      [true, true, true],
    );
    assert.equal(closed(o.w, o.d.querySelector('[data-click="exportVouchers"]')), true);
  } finally {
    o.w.close();
  }
});

test('Rebrickable banner only in collection and catalog', async () => {
  const o = await openUi(
    { '/v2/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: '' } } },
    { before: withStyle },
  );
  try {
    const band = o.d.getElementById('rb-hint');
    await waitFor(() => !band.hidden, 2000);
    assert.equal(closed(o.w, band), false, 'collection');
    for (const [tab, hidden] of /** @type {[string, boolean][]} */ ([
      ['finance', true],
      ['wanted', true],
      ['catalog', false],
      ['parts', false],
    ])) {
      await switchTab(o.w, tab);
      assert.equal(closed(o.w, band), hidden, tab);
    }
  } finally {
    o.w.close();
  }
});

test('QR area only with a code', async () => {
  const o = await openUi({}, { before: withStyle });
  try {
    const f = o.d.getElementById('qr-code');
    assert.equal(o.w.getComputedStyle(f).display, 'none');
    f.innerHTML = '<canvas></canvas>';
    assert.notEqual(o.w.getComputedStyle(f).display, 'none');
  } finally {
    o.w.close();
  }
});

test('no access for a normal account, administrator sees none of it', async () => {
  const normal = await openUi({
    '/v2/auth/me': { loggedIn: true, user: { id: 2, username: 'bert', is_admin: false } },
  });
  try {
    normal.d.querySelector('.ntab[data-tab="settings"]').click();
    await tick(50);
    const f = normal.d.getElementById('settings-no-access');
    assert.equal(f.hidden, false);
    assert.match(f.textContent, /Kein Zugriff/);
  } finally {
    normal.w.close();
  }
  const chef = await openUi({});
  try {
    chef.d.querySelector('.ntab[data-tab="settings"]').click();
    await tick(50);
    assert.equal(chef.d.getElementById('settings-no-access').hidden, true);
  } finally {
    chef.w.close();
  }
});

test('design: one sentence for the choice, Noppe and Hochglanz different', async () => {
  const texts = {};
  for (const design of ['noppe', 'hochglanz', 'werkbank']) {
    const o = await openUi({
      '/v2/settings/theme': { success: true, preset: 'classic', own: design, theme: design },
      '/v2/auth/profile': {
        success: true,
        user: { username: 'anna', email: 'anna@example.org', email_verified: true },
      },
    });
    try {
      await view(o.w, 'profile');
      await waitFor(() => o.d.getElementById('design-hint').textContent);
      texts[design] = o.d.getElementById('design-hint').textContent;
    } finally {
      o.w.close();
    }
  }
  assert.match(texts.noppe, /verspielt/);
  assert.match(texts.hochglanz, /glatte Flächen/);
  assert.match(texts.werkbank, /Messing/);
});
