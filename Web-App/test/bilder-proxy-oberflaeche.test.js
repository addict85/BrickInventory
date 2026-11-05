/**
 * Teilebilder laufen in jsdom nachweislich über den Bild-Proxy: Kachel,
 * Zoom-Adresse und manuell erfasste Teile. Die Vorschau-Adresse rät der
 * Client nicht selbst (kein „_thumb.jpg“), er nimmt, was der Server liefert.
 */
/*
 * Gegenproben (05.11.2026, je einzeln, Bündel neu gebaut):
 *   A  partsCard mit `orig: rawSrc` statt imgUrl(fullUrl(rawSrc), false) → „Teilekachel …“ rot
 *   B  renderManualParts mit `const imgSrc = p.image_local || p.image_url || ''` → „manuell …“ rot
 *   C  thumbUrl() hängt wieder `_thumb.jpg` an → „Teilekachel …“ und „manuell …“ rot
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
