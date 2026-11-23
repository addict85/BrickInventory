/**
 * Every image from a template has an alt and the uniform placeholder:
 * if it does not load, the same tinted area stands there as for an entry without an
 * image — not the browser icon for broken images. Checked on the real bundle
 * in jsdom; the error is triggered as an error event on the image, as the
 * browser does (first retry, then original size, then placeholder).
 *
 * Counter-checks (measured on 28.10.):
 *   A  in aktionen.js again removeAttribute('src') instead of imagePlaceholder()
 *      → red: “gallery: broken image becomes the placeholder"
 *   B  the alt omitted in imageTag() (bilder.js) → red: “alt on every image"
 *   C  (03.11.) placeholderContent('set') again the icon instead of
 *      set-placeholder.svg → red: “gallery: broken image becomes the placeholder"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab, waitFor, tick } = require('./helpers/ui');

const IMAGE = '/images/sets/10294-1.jpg';
const SETS = [
  {
    set_number: '10294-1',
    name: 'Titanic',
    year: 2021,
    quantity: 1,
    image_local: IMAGE,
    conditions: ['N'],
    instructions: [],
  },
];
const PARTS = [
  {
    part_number: '3001',
    part_name: 'Brick 2 x 4',
    color_id: 4,
    color_name: 'Red',
    color_hex: 'C91A09',
    quantity: 2,
    conditions: ['U'],
    image_local: '/images/parts/3001.png',
  },
];
const MINIFIGS = [
  {
    fig_number: 'fig-000123',
    fig_name: 'Chewbacca',
    quantity: 1,
    conditions: ['N'],
    image_local: '/images/figs/fig-000123.png',
  },
];
const SET_PARTS = [
  {
    part_number: '3020',
    part_name: 'Plate 2 x 4',
    color_name: 'Red',
    color_hex: 'C91A09',
    color_id: 4,
    total_quantity: 3,
    image_local: '/images/parts/3020.png',
  },
];

const RESPONSES = {
  '/v2/sets': { success: true, sets: SETS, total: 1, themes: [] },
  '/v2/parts/manual': { success: true, parts: PARTS },
  '/v2/parts': { success: true, parts: SET_PARTS, total: 1 },
  '/v2/minifigs/manual': { success: true, figs: MINIFIGS },
  '/v2/minifigs': { success: true, figs: [{ ...MINIFIGS[0], source: 'set', total_quantity: 1 }], total: 1 },
  '/v2/finance/valuation': {
    success: true,
    currency: 'EUR',
    totals: { min: '0', avg: '0', max: '0' },
    sets: [{ ...SETS[0], purchase_price: 629, avg_price: 0, total_avg: '0' }],
  },
  '/v2/finance/parts-valuation': { success: true, currency: 'EUR', total_value: '0', parts: PARTS },
};

/** All <img> of an area that come from templates. */
const images = (d, sel) => [...d.querySelectorAll(`${sel} img`)];

test('alt on every image and the placeholder path on every template image', async () => {
  const { w, d } = await openUi(RESPONSES);
  try {
    const seen = [];
    const check = (name, sel) => {
      const list = images(d, sel);
      assert.ok(list.length > 0, `${name}: no images drawn — checks nothing`);
      for (const img of list) {
        assert.ok(img.hasAttribute('alt'), `${name}: <img src="${img.getAttribute('src')}"> without alt`);
        assert.equal(img.dataset.onerror, 'placeholder', `${name}: ${img.getAttribute('src')} without a placeholder`);
      }
      seen.push(name);
    };
    await waitFor(() => d.querySelector('#gallery .sc img'));
    check('Galerie-Kachel', '#gallery');
    // The tile is a button and names the set in text; an alt named it twice.
    assert.equal(
      d.querySelector('#gallery .sc img').getAttribute('alt'),
      '',
      'Image in the tile without a duplicate name',
    );
    assert.match(d.querySelector('#gallery .sc').textContent, /Titanic/, 'The tile does not name the set');
    d.getElementById('vl').click();
    await tick(30);
    check('Galerie-Tabelle', '#gallery');
    d.getElementById('vg').click();
    await tick(30);

    await switchTab(w, 'parts');
    await waitFor(() => d.querySelector('#parts-main .part-card img') && d.querySelector('#manual-parts-list img'));
    check('Teile', '#tab-parts');
    await switchTab(w, 'minifigs');
    await waitFor(() => d.querySelector('#figs-list img') && d.querySelector('#manual-figs-list img'));
    check('Minifiguren', '#tab-minifigs');
    await switchTab(w, 'finance');
    await waitFor(() => d.querySelector('#fin-tbl img'));
    check('Finanzen', '#fin-tbl');
    assert.equal(seen.length, 5);
  } finally {
    w.close();
  }
});

test('gallery: a broken image becomes a placeholder', async () => {
  const { w, d } = await openUi(RESPONSES);
  try {
    await waitFor(() => d.querySelector('#gallery .sc img'));
    const img = d.querySelector('#gallery .sc img');
    const error = () => img.dispatchEvent(new w.Event('error'));
    error(); // 1st attempt: retry in one second
    error(); // 2nd attempt: full resolution (data-orig)
    error(); // 3rd attempt: placeholder
    await tick(10);
    const sci = d.querySelector('#gallery .sc .sci');
    assert.equal(sci.querySelector('img[data-onerror]'), null, 'The broken image is still there');
    const ph = sci.querySelector('.image-ph');
    assert.ok(ph, 'No placeholder in its place');
    // Without alt (the tile names the set in text) the placeholder is decoration.
    assert.equal(ph.getAttribute('aria-hidden'), 'true');
    assert.equal(
      ph.querySelector('img')?.getAttribute('src'),
      '/assets/set-placeholder.svg',
      'Not the same placeholder as for a set without an image',
    );
  } finally {
    w.close();
  }
});
