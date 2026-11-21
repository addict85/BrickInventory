/**
 * Images demonstrably go via the image proxy in jsdom: part tile, set detail,
 * zoom, minifigure tile and manually entered parts. The client does not guess the preview address
 * itself (no “_thumb.jpg”), it takes what the server delivers.
 */
/*
 * Counter-checks (05.11.2026, each alone, bundle rebuilt):
 *   A  partsCard with `orig: rawSrc` instead of imgUrl(fullUrl(rawSrc), false) → “part tile …” red
 *   B  renderManualParts with `const imgSrc = p.image_local || p.image_url || ''` → “manual …” red
 *   C  thumbUrl() appends `_thumb.jpg` again → “part tile …” and “manual …” red
 * Counter-checks (08.11.2026, each alone, bundle rebuilt):
 *   D  fullUrl() returns an absolute CDN address raw again (`return src`
 *      instead of via IMG_PROXY) → “set detail and zoom …” red
 *   E  openModal sets m-img again with `set.image_local||set.image_url` without
 *      fullUrl() → “set detail and zoom …” red (preview instead of full resolution)
 *   F  openImageLightboxFromEl takes `this.src` again instead of data-orig/fullUrl
 *      → “set detail and zoom …” red
 *   G  minifigure tile with `orig: imgSrc` instead of fullUrl(imgSrc) → “minifigure …” red
 *   H  imgUrl() returns an absolute address raw → “part tile …” and
 *      “manual …” red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter } = require('./helpers/ui');

const CDN = 'https://cdn.rebrickable.com/media/parts/elements/300121.jpg';
const proxy = url => `/api/v1/img-proxy?url=${encodeURIComponent(url)}`;

test('part tile: preview and zoom via the proxy, without a guessed preview address', async () => {
  const { w, d, warte } = await openUi({
    '/v1/parts': {
      success: true,
      parts: [
        { part_number: '3001', part_name: 'Stein', color_id: 5, color_name: 'Red', total_quantity: 1, image_url: CDN },
      ],
      total: 1,
      page: 1,
      page_size: 100,
    },
  });
  try {
    await reiter(w, 'parts');
    assert.ok(await warte(() => d.querySelector('#parts-main .part-card img')));
    const img = d.querySelector('#parts-main .part-card img');
    assert.equal(img.getAttribute('src'), `${proxy(CDN)}&thumb=1`);
    assert.equal(img.dataset.orig, proxy(CDN));
    assert.doesNotMatch(d.getElementById('parts-main').innerHTML, /_thumb\.jpg|src="https:/);
  } finally {
    w.close();
  }
});

test('manually captured part: tile image via the proxy', async () => {
  const { w, d, warte } = await openUi({
    '/v1/parts/manual': {
      success: true,
      parts: [
        { part_number: '3002', part_name: 'Stein 2 x 3', color_id: 5, color_name: 'Red', quantity: 2, image_url: CDN },
      ],
    },
  });
  try {
    await reiter(w, 'parts');
    assert.ok(await warte(() => d.querySelector('#manual-parts-list .man-tile img')));
    const img = d.querySelector('#manual-parts-list .man-tile img');
    assert.equal(img.getAttribute('src'), `${proxy(CDN)}&thumb=1`);
    assert.doesNotMatch(d.getElementById('manual-parts-list').innerHTML, /_thumb\.jpg|src="https:/);
  } finally {
    w.close();
  }
});

test('set detail and zoom: full resolution, a CDN address only via the proxy', async () => {
  const SET_CDN = 'https://cdn.rebrickable.com/media/sets/10294-1.jpg';
  const set = (nr, felder) => ({ set_number: nr, name: `Set ${nr}`, year: 2021, quantity: 1, ...felder });
  const { w, d, warte } = await openUi({
    '/v1/sets': {
      success: true,
      total: 2,
      themes: [],
      sets: [set('10294-1', { image_url: SET_CDN }), set('10295-1', { image_local: '/images/sets/10295-1_thumb.jpg' })],
    },
    '/v1/sets/10294-1': { success: true, set: set('10294-1', { image_url: SET_CDN }) },
    '/v1/sets/10295-1': { success: true, set: set('10295-1', { image_local: '/images/sets/10295-1_thumb.jpg' }) },
  });
  try {
    const oeffne = async nr => {
      d.querySelector(`#gallery [data-click="openModal"][data-arg="${nr}"]`).click();
      assert.ok(
        await warte(() => !/set-placeholder/.test(d.getElementById('m-img').getAttribute('src'))),
        `Detail ${nr}`,
      );
      return d.getElementById('m-img').getAttribute('src');
    };
    assert.ok(await warte(() => d.querySelector('#gallery [data-click="openModal"]')));
    assert.equal(await oeffne('10294-1'), proxy(SET_CDN), 'Das Detail lädt direkt beim CDN');
    // The zoom opens the same full resolution, likewise via the own server.
    d.getElementById('m-img').click();
    assert.ok(await warte(() => d.getElementById('lightbox-img').getAttribute('src')));
    assert.equal(d.getElementById('lightbox-img').getAttribute('src'), proxy(SET_CDN));
    d.getElementById('set-modal').classList.remove('open');
    assert.equal(
      await oeffne('10295-1'),
      '/images/sets/10295-1.jpg',
      'Das Detail zeigt die Vorschau statt der vollen Auflösung',
    );
  } finally {
    w.close();
  }
});

test("minifigure: the tile's data-orig goes via the proxy", async () => {
  const FIG_CDN = 'https://cdn.rebrickable.com/media/sets/fig-000123.jpg';
  const { w, d, warte } = await openUi({
    '/v1/minifigs': {
      success: true,
      total: 1,
      figs: [{ fig_number: 'fig-000123', fig_name: 'Chewbacca', source: 'set', total_quantity: 1, image_url: FIG_CDN }],
    },
  });
  try {
    await reiter(w, 'minifigs');
    assert.ok(await warte(() => d.querySelector('#figs-list img[data-orig]')));
    for (const img of d.querySelectorAll('#figs-list img[data-orig]')) {
      assert.equal(img.dataset.orig, proxy(FIG_CDN));
      assert.notEqual(
        img.dataset.orig,
        img.getAttribute('src'),
        'Der Rückfall holte sonst dieselbe Adresse noch einmal',
      );
    }
  } finally {
    w.close();
  }
});
