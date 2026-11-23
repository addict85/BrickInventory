/**
 * Tiles and wishlist rows: the trash can is a shortcut for the
 * mouse and does not stand in the tab order (deleting via keyboard happens in the
 * detail dialog); a wishlist item row without a name names the set number once
 * and leaves room for the trash can on the right. On the real bundle in jsdom.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  tabindex="-1" removed on the trash can of the set tile → red: “gallery:
 *      the trash is not in the tab order”
 *   B  the set number again always in the subline → red: „Merkliste: …
 *      Nummer einmal“ (2 times)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const TABBAR = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]';
const tabbar = root => [...root.querySelectorAll(TABBAR)].filter(el => el.getAttribute('tabindex') !== '-1');

test('gallery: the trash is not in the tab order', async () => {
  const { w, d } = await openUi({
    '/v2/sets': {
      success: true,
      total: 2,
      themes: [],
      sets: [
        { set_number: '10294-1', name: 'Titanic', quantity: 1, year: 2021 },
        { set_number: '42143-1', name: 'Ferrari', quantity: 1, year: 2022 },
      ],
    },
  });
  try {
    await waitFor(() => d.querySelectorAll('#gallery .sc').length === 2);
    const gallery = d.getElementById('gallery');
    assert.equal(gallery.querySelectorAll('.delbtn').length, 2, 'the tiles carry no trash can');
    const inTab = tabbar(gallery);
    assert.deepEqual(inTab.filter(el => el.classList.contains('delbtn')).length, 0, 'a trash can is in the tab order');
    assert.equal(inTab.length, 2, 'exactly one stop per tile');
    for (const b of gallery.querySelectorAll('.delbtn'))
      assert.equal(b.getAttribute('aria-hidden'), 'true', 'the trash can sits in the tile as a second button');
  } finally {
    w.close();
  }
});

test('wishlist: without a name the number appears once, space stays on the right', async () => {
  const { w, d } = await openUi({
    '/v2/wanted': {
      success: true,
      item: [{ set_number: '99999-1', name: null, condition: 'N', user_id: 1, market_price: 12.5, currency: 'EUR' }],
    },
  });
  try {
    await switchTab(w, 'wanted');
    await waitFor(() => d.querySelector('.mk-row'));
    const row = d.querySelector('.mk-row');
    const n = (row.textContent.match(/99999-1/g) || []).length;
    assert.equal(n, 1, `wanted list: number once — it appears ${n} times`);
    // Since 29.10. the class (styles.css) holds the space; the row carries no inline style any more.
    assert.equal(row.getAttribute('style'), null, 'the row carries an inline style again');
    assert.match(
      require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'styles.css'), 'utf8'),
      /\.mk-row\{[^}]*padding:10px 44px 10px 10px/,
      'no room on the right for the trash can',
    );
    assert.equal(tabbar(row).filter(el => el !== row).length, 0, 'the trash can is in the tab order');
  } finally {
    w.close();
  }
});
