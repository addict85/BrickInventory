/**
 * Bilder laufen in jsdom nachweislich über den Bild-Proxy: Teilekachel, Set-Detail,
 * Zoom, Figurenkachel und manuell erfasste Teile. Die Vorschau-Adresse rät der
 * Client nicht selbst (kein „_thumb.jpg“), er nimmt, was der Server liefert.
 */
/*
 * Gegenproben (05.11.2026, je einzeln, Bündel neu gebaut):
 *   A  partsCard mit `orig: rawSrc` statt imgUrl(fullUrl(rawSrc), false) → „Teilekachel …“ rot
 *   B  renderManualParts mit `const imgSrc = p.image_local || p.image_url || ''` → „manuell …“ rot
 *   C  thumbUrl() hängt wieder `_thumb.jpg` an → „Teilekachel …“ und „manuell …“ rot
 * Gegenproben (08.11.2026, je einzeln, Bündel neu gebaut):
 *   D  fullUrl() gibt eine absolute CDN-Adresse wieder roh zurück (`return src`
 *      statt über IMG_PROXY) → „Set-Detail und Zoom …“ rot
 *   E  openModal setzt m-img wieder mit `set.image_local||set.image_url` ohne
 *      fullUrl() → „Set-Detail und Zoom …“ rot (Vorschau statt voller Auflösung)
 *   F  openImageLightboxFromEl nimmt wieder `this.src` statt data-orig/fullUrl
 *      → „Set-Detail und Zoom …“ rot
 *   G  Figurenkachel mit `orig: imgSrc` statt fullUrl(imgSrc) → „Minifigur …“ rot
 *   H  imgUrl() gibt eine absolute Adresse roh zurück → „Teilekachel …“ und
 *      „manuell …“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter } = require('./helpers/oberflaeche');

const CDN = 'https://cdn.rebrickable.com/media/parts/elements/300121.jpg';
const proxy = url => `/api/v1/img-proxy?url=${encodeURIComponent(url)}`;

test('Teilekachel: Vorschau und Zoom über den Proxy, ohne erratene Vorschau-Adresse', async () => {
  const { w, d, warte } = await oeffneOberflaeche({
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

test('manuell erfasstes Teil: Kachelbild über den Proxy', async () => {
  const { w, d, warte } = await oeffneOberflaeche({
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

test('Set-Detail und Zoom: volle Auflösung, eine CDN-Adresse nur über den Proxy', async () => {
  const SET_CDN = 'https://cdn.rebrickable.com/media/sets/10294-1.jpg';
  const set = (nr, felder) => ({ set_number: nr, name: `Set ${nr}`, year: 2021, quantity: 1, ...felder });
  const { w, d, warte } = await oeffneOberflaeche({
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
    // Der Zoom öffnet dieselbe volle Auflösung, ebenfalls über den eigenen Server.
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

test('Minifigur: data-orig der Kachel geht über den Proxy', async () => {
  const FIG_CDN = 'https://cdn.rebrickable.com/media/sets/fig-000123.jpg';
  const { w, d, warte } = await oeffneOberflaeche({
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
