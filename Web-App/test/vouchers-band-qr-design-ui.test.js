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
const { openUi, reiter, sicht, warte, takt } = require('./helpers/ui');

const STYLE = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const withStyle = w =>
  w.document.addEventListener('DOMContentLoaded', () => {
    const s = w.document.createElement('style');
    s.textContent = STYLE;
    w.document.head.append(s);
  });
const zu = (w, e) => {
  for (let x = e; x && x.nodeType === 1; x = x.parentElement) if (w.getComputedStyle(x).display === 'none') return true;
  return false;
};

const GUTSCHEIN = {
  id: 3,
  number: '6123456789012',
  pin: '4711',
  amount: 50,
  currency: 'CHF',
  hat_pdf: false,
  guthaben_geprueft_am: null,
};

test('vouchers: row and actions', async () => {
  const o = await openUi({ '/v1/vouchers': { success: true, vouchers: [GUTSCHEIN] } }, { before: withStyle });
  try {
    await sicht(o.w, 'vouchers');
    await warte(() => o.d.querySelector('.voucher-row'));
    const zeile = o.d.querySelector('.voucher-row');
    assert.match(zeile.querySelector('.voucher-nopdf').textContent.trim(), /^kein PDF$/);
    const loeschen = zeile.querySelector('[data-click="deleteVoucher"]');
    const bearbeiten = zeile.querySelector('[data-click="editVoucher"]');
    // Both labeled (UI check 6, M7), delete marked as danger.
    assert.equal(loeschen.className, bearbeiten.className + ' v-btn-danger');
    assert.deepEqual([bearbeiten.textContent.trim(), loeschen.textContent.trim()], ['Bearbeiten', 'Löschen']);
    for (const e of o.d.querySelectorAll('[data-only-with-vouchers]')) assert.equal(zu(o.w, e), false);
  } finally {
    o.w.close();
  }
});

test('without vouchers: no sum, no “query all”, no export', async () => {
  const o = await openUi({ '/v1/vouchers': { success: true, vouchers: [] } }, { before: withStyle });
  try {
    await sicht(o.w, 'vouchers');
    await warte(() => o.d.querySelector('.voucher-empty'));
    const teile = [...o.d.querySelectorAll('[data-only-with-vouchers]')];
    assert.equal(teile.length, 3);
    assert.deepEqual(
      teile.map(e => zu(o.w, e)),
      [true, true, true],
    );
    assert.equal(zu(o.w, o.d.querySelector('[data-click="exportVouchers"]')), true);
  } finally {
    o.w.close();
  }
});

test('Rebrickable banner only in collection and catalog', async () => {
  const o = await openUi(
    { '/v1/settings/raw': { success: true, settings: { currency: 'EUR', language: 'de', rebrickable_api_key: '' } } },
    { before: withStyle },
  );
  try {
    const band = o.d.getElementById('rb-hint');
    await warte(() => !band.hidden, 2000);
    assert.equal(zu(o.w, band), false, 'Sammlung');
    for (const [tab, versteckt] of /** @type {[string, boolean][]} */ ([
      ['finance', true],
      ['wanted', true],
      ['catalog', false],
      ['parts', false],
    ])) {
      await reiter(o.w, tab);
      assert.equal(zu(o.w, band), versteckt, tab);
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
    '/v1/auth/me': { loggedIn: true, user: { id: 2, username: 'bert', is_admin: false } },
  });
  try {
    normal.d.querySelector('.ntab[data-tab="settings"]').click();
    await takt(50);
    const f = normal.d.getElementById('settings-no-access');
    assert.equal(f.hidden, false);
    assert.match(f.textContent, /Kein Zugriff/);
  } finally {
    normal.w.close();
  }
  const chef = await openUi({});
  try {
    chef.d.querySelector('.ntab[data-tab="settings"]').click();
    await takt(50);
    assert.equal(chef.d.getElementById('settings-no-access').hidden, true);
  } finally {
    chef.w.close();
  }
});

test('design: one sentence for the choice, Noppe and Hochglanz different', async () => {
  const texte = {};
  for (const design of ['noppe', 'hochglanz', 'werkbank']) {
    const o = await openUi({
      '/v1/settings/theme': { success: true, vorgabe: 'classic', eigenes: design, theme: design },
      '/v1/auth/profile': {
        success: true,
        user: { username: 'anna', email: 'anna@example.org', email_verified: true },
      },
    });
    try {
      await sicht(o.w, 'profile');
      await warte(() => o.d.getElementById('design-hint').textContent);
      texte[design] = o.d.getElementById('design-hint').textContent;
    } finally {
      o.w.close();
    }
  }
  assert.match(texte.noppe, /verspielt/);
  assert.match(texte.hochglanz, /glatte Flächen/);
  assert.match(texte.werkbank, /Messing/);
});
