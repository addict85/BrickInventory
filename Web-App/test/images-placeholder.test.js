/**
 * Every image from a template has an alt and the uniform placeholder:
 * if it does not load, the same tinted area stands there as for an entry without an
 * image — not the browser icon for broken images. Checked on the real bundle
 * in jsdom; the error is triggered as an error event on the image, as the
 * browser does (first retry, then original size, then placeholder).
 *
 * Counter-checks (measured on 28.10.):
 *   A  in aktionen.js again removeAttribute('src') instead of bildPlatzhalter()
 *      → red: “gallery: broken image becomes the placeholder"
 *   B  the alt omitted in bildTag() (bilder.js) → red: “alt on every image"
 *   C  (03.11.) placeholderContent('set') again the icon instead of
 *      set-placeholder.svg → red: “gallery: broken image becomes the placeholder"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte, takt } = require('./helpers/ui');

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
const TEILE = [
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
const FIGUREN = [
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
  '/v1/sets': { success: true, sets: SETS, total: 1, themes: [] },
  '/v1/parts/manual': { success: true, parts: TEILE },
  '/v1/parts': { success: true, parts: SET_PARTS, total: 1 },
  '/v1/minifigs/manual': { success: true, figs: FIGUREN },
  '/v1/minifigs': { success: true, figs: [{ ...FIGUREN[0], source: 'set', total_quantity: 1 }], total: 1 },
  '/v1/finance/valuation': {
    success: true,
    currency: 'EUR',
    totals: { min: '0', avg: '0', max: '0' },
    sets: [{ ...SETS[0], purchase_price: 629, avg_price: 0, total_avg: '0' }],
  },
  '/v1/finance/parts-valuation': { success: true, currency: 'EUR', total_value: '0', parts: TEILE },
};

/** All <img> of an area that come from templates. */
const bilder = (d, sel) => [...d.querySelectorAll(`${sel} img`)];

test('alt on every image and the placeholder path on every template image', async () => {
  const { w, d } = await openUi(RESPONSES);
  try {
    const gesehen = [];
    const pruefe = (name, sel) => {
      const liste = bilder(d, sel);
      assert.ok(liste.length > 0, `${name}: keine Bilder gezeichnet — prüft nichts`);
      for (const img of liste) {
        assert.ok(img.hasAttribute('alt'), `${name}: <img src="${img.getAttribute('src')}"> ohne alt`);
        assert.equal(img.dataset.onerror, 'platzhalter', `${name}: ${img.getAttribute('src')} ohne Platzhalter`);
      }
      gesehen.push(name);
    };
    await warte(() => d.querySelector('#gallery .sc img'));
    pruefe('Galerie-Kachel', '#gallery');
    // The tile is a button and names the set in text; an alt named it twice.
    assert.equal(
      d.querySelector('#gallery .sc img').getAttribute('alt'),
      '',
      'Bild in der Kachel ohne doppelten Namen',
    );
    assert.match(d.querySelector('#gallery .sc').textContent, /Titanic/, 'Die Kachel nennt das Set nicht');
    d.getElementById('vl').click();
    await takt(30);
    pruefe('Galerie-Tabelle', '#gallery');
    d.getElementById('vg').click();
    await takt(30);

    await reiter(w, 'parts');
    await warte(() => d.querySelector('#parts-main .part-card img') && d.querySelector('#manual-parts-list img'));
    pruefe('Teile', '#tab-parts');
    await reiter(w, 'minifigs');
    await warte(() => d.querySelector('#figs-list img') && d.querySelector('#manual-figs-list img'));
    pruefe('Minifiguren', '#tab-minifigs');
    await reiter(w, 'finance');
    await warte(() => d.querySelector('#fin-tbl img'));
    pruefe('Finanzen', '#fin-tbl');
    assert.equal(gesehen.length, 5);
  } finally {
    w.close();
  }
});

test('gallery: a broken image becomes a placeholder', async () => {
  const { w, d } = await openUi(RESPONSES);
  try {
    await warte(() => d.querySelector('#gallery .sc img'));
    const img = d.querySelector('#gallery .sc img');
    const fehler = () => img.dispatchEvent(new w.Event('error'));
    fehler(); // 1st attempt: retry in one second
    fehler(); // 2nd attempt: full resolution (data-orig)
    fehler(); // 3rd attempt: placeholder
    await takt(10);
    const sci = d.querySelector('#gallery .sc .sci');
    assert.equal(sci.querySelector('img[data-onerror]'), null, 'Das kaputte Bild steht noch da');
    const ph = sci.querySelector('.bild-ph');
    assert.ok(ph, 'Kein Platzhalter an seiner Stelle');
    // Without alt (the tile names the set in text) the placeholder is decoration.
    assert.equal(ph.getAttribute('aria-hidden'), 'true');
    assert.equal(
      ph.querySelector('img')?.getAttribute('src'),
      '/assets/set-placeholder.svg',
      'Nicht derselbe Platzhalter wie für ein Set ohne Bild',
    );
  } finally {
    w.close();
  }
});
