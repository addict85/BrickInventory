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
const { openUi, reiter, warte } = require('./helpers/ui');

const TABBAR = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]';
const tabbar = wurzel => [...wurzel.querySelectorAll(TABBAR)].filter(el => el.getAttribute('tabindex') !== '-1');

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
    await warte(() => d.querySelectorAll('#gallery .sc').length === 2);
    const galerie = d.getElementById('gallery');
    assert.equal(galerie.querySelectorAll('.delbtn').length, 2, 'die Kacheln tragen keinen Papierkorb');
    const imTab = tabbar(galerie);
    assert.deepEqual(
      imTab.filter(el => el.classList.contains('delbtn')).length,
      0,
      'ein Papierkorb steht in der Tab-Folge',
    );
    assert.equal(imTab.length, 2, 'je Kachel genau ein Halt');
    for (const b of galerie.querySelectorAll('.delbtn'))
      assert.equal(
        b.getAttribute('aria-hidden'),
        'true',
        'der Papierkorb steckt als zweite Schaltfläche in der Kachel',
      );
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
    await reiter(w, 'wanted');
    await warte(() => d.querySelector('.mk-row'));
    const row = d.querySelector('.mk-row');
    const n = (row.textContent.match(/99999-1/g) || []).length;
    assert.equal(n, 1, `Merkliste: Nummer einmal — steht ${n}-mal da`);
    // Since 29.10. the class (styles.css) holds the space; the row carries no inline style any more.
    assert.equal(row.getAttribute('style'), null, 'die Zeile trägt wieder einen Inline-Stil');
    assert.match(
      require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'styles.css'), 'utf8'),
      /\.mk-row\{[^}]*padding:10px 44px 10px 10px/,
      'rechts kein Platz für den Papierkorb',
    );
    assert.equal(tabbar(row).filter(el => el !== row).length, 0, 'der Papierkorb steht in der Tab-Folge');
  } finally {
    w.close();
  }
});
