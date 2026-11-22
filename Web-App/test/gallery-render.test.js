/**
 * No flickering of the tile wall: loaded images are visible immediately, and
 * prices are filled into the existing tiles instead of rebuilding the wall.
 * In jsdom, with images that count as loaded.
 *
 * Counter-checks (05.11.2026, each alone, bundle rebuilt):
 *   A  the check `complete` removed in observeLazyImages AND in the MutationObserver of
 *      aktionen.js → “loaded images …” red. Each one alone stays
 *      green: both paths mark before the next image, one suffices.
 *   B  enrichGalleryWithPrices calls renderGallery() instead of updateGalleryPrices()
 *      → “prices come into the existing tile …” red (new <img>)
 *   C  price container rendered without `hidden` → same place red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openUi } = require('./helpers/ui');

const STILE = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const SETS = {
  success: true,
  sets: [
    {
      set_number: '10294-1',
      name: 'Titanic',
      quantity: 1,
      image_url: 'https://cdn.rebrickable.com/media/sets/10294-1.jpg',
    },
    {
      set_number: '21318-1',
      name: 'Baumhaus',
      quantity: 1,
      image_url: 'https://cdn.rebrickable.com/media/sets/21318-1.jpg',
    },
  ],
  count: 2,
  total: 2,
};

/** Images count as fully loaded, as from the browser's cache. */
function loadedImages(w) {
  Object.defineProperty(w.HTMLImageElement.prototype, 'complete', { get: () => true });
  Object.defineProperty(w.HTMLImageElement.prototype, 'naturalWidth', { get: () => 120 });
  const stil = w.document.createElement('style');
  stil.textContent = STILE;
  w.document.head.append(stil);
}

test('loaded images are marked as loaded immediately, also in the list', async () => {
  const { w, d, warte } = await openUi({ '/v2/sets': SETS }, { before: loadedImages });
  try {
    assert.ok(await warte(() => d.querySelectorAll('#gallery img').length === 2));
    const notLoaded = () => [...d.querySelectorAll('#gallery img')].filter(i => !i.classList.contains('loaded'));
    assert.deepEqual(
      notLoaded().map(i => i.outerHTML.slice(0, 60)),
      [],
    );
    d.getElementById('vl').click();
    assert.ok(await warte(() => d.querySelector('#gallery .tw img, #gallery table img')));
    assert.deepEqual(
      notLoaded().map(i => i.outerHTML.slice(0, 60)),
      [],
      'Listenansicht',
    );
  } finally {
    w.close();
  }
});

test('prices go into the existing tile; an empty container is hidden', async () => {
  let priceLos;
  const preise = new Promise(r => {
    priceLos = r;
  });
  const { w, d, warte, ruhig } = await openUi(
    {
      '/v2/sets': SETS,
      '/v2/finance/pnl': () =>
        preise.then(() => ({
          success: true,
          currency: 'EUR',
          sets: [{ set_number: '10294-1', quantity: 1, tile_price: 679.99, tile_source: 'markt' }],
          totals: { purchase: '0', current: '679.99', foreign_currency_purchases: 0 },
        })),
    },
    { before: loadedImages },
  );
  try {
    assert.ok(await warte(() => d.querySelector('#gallery [data-price-for="10294-1"]')));
    const image = d.querySelector('#gallery img');
    const titanic = d.querySelector('#gallery [data-price-for="10294-1"]');
    const treehouse = d.querySelector('#gallery [data-price-for="21318-1"]');
    assert.equal(titanic.hidden, true, 'vor dem Preis verborgen');
    assert.equal(w.getComputedStyle(titanic).display, 'none', '.price-badge[hidden] muss display:none setzen');
    priceLos();
    assert.ok(await warte(() => /679/.test(d.querySelector('#gallery [data-price-for="10294-1"]')?.textContent || '')));
    await ruhig();
    assert.equal(d.querySelector('#gallery img'), image, 'die Kachelwand wurde neu gebaut');
    assert.equal(d.querySelector('#gallery [data-price-for="10294-1"]'), titanic);
    assert.equal(titanic.hidden, false);
    assert.equal(treehouse.hidden, true, 'ohne Preis bleibt der Container verborgen');
  } finally {
    w.close();
  }
});
