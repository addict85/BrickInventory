/**
 * Kein Flackern der Kachelwand: geladene Bilder sind sofort sichtbar, und
 * Preise werden in die bestehenden Kacheln nachgetragen statt die Wand neu zu
 * bauen. In jsdom, mit Bildern, die als geladen gelten.
 *
 * Gegenproben (05.11.2026, je einzeln, Bündel neu gebaut):
 *   A  die Prüfung `complete` in observeLazyImages UND im MutationObserver von
 *      actions.js entfernt → „geladene Bilder …“ rot. Je eine allein bleibt
 *      grün: Beide Wege markieren vor dem nächsten Bild, einer genügt.
 *   B  enrichGalleryWithPrices ruft renderGallery() statt updateGalleryPrices()
 *      → „Preise kommen in die bestehende Kachel …“ rot (neues <img>)
 *   C  Preis-Container ohne `hidden` gerendert → ebenda rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oeffneOberflaeche } = require('./helpers/oberflaeche');

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

/** Bilder gelten als fertig geladen, wie aus dem Cache des Browsers. */
function geladeneBilder(w) {
  Object.defineProperty(w.HTMLImageElement.prototype, 'complete', { get: () => true });
  Object.defineProperty(w.HTMLImageElement.prototype, 'naturalWidth', { get: () => 120 });
  const stil = w.document.createElement('style');
  stil.textContent = STILE;
  w.document.head.append(stil);
}

test('geladene Bilder sind sofort als loaded markiert, auch in der Liste', async () => {
  const { w, d, warte } = await oeffneOberflaeche({ '/v1/sets': SETS }, { vorher: geladeneBilder });
  try {
    assert.ok(await warte(() => d.querySelectorAll('#gallery img').length === 2));
    const nichtGeladen = () => [...d.querySelectorAll('#gallery img')].filter(i => !i.classList.contains('loaded'));
    assert.deepEqual(
      nichtGeladen().map(i => i.outerHTML.slice(0, 60)),
      [],
    );
    d.getElementById('vl').click();
    assert.ok(await warte(() => d.querySelector('#gallery .tw img, #gallery table img')));
    assert.deepEqual(
      nichtGeladen().map(i => i.outerHTML.slice(0, 60)),
      [],
      'Listenansicht',
    );
  } finally {
    w.close();
  }
});

test('Preise kommen in die bestehende Kachel; ein leerer Container ist verborgen', async () => {
  let preisLos;
  const preise = new Promise(r => {
    preisLos = r;
  });
  const { w, d, warte, ruhig } = await oeffneOberflaeche(
    {
      '/v1/sets': SETS,
      '/v1/finance/pnl': () =>
        preise.then(() => ({
          success: true,
          currency: 'EUR',
          sets: [{ set_number: '10294-1', quantity: 1, kachel_preis: 679.99, kachel_quelle: 'markt' }],
          totals: { purchase: '0', current: '679.99', kaufpreise_fremde_waehrung: 0 },
        })),
    },
    { vorher: geladeneBilder },
  );
  try {
    assert.ok(await warte(() => d.querySelector('#gallery [data-price-for="10294-1"]')));
    const bild = d.querySelector('#gallery img');
    const titanic = d.querySelector('#gallery [data-price-for="10294-1"]');
    const baumhaus = d.querySelector('#gallery [data-price-for="21318-1"]');
    assert.equal(titanic.hidden, true, 'vor dem Preis verborgen');
    assert.equal(w.getComputedStyle(titanic).display, 'none', '.price-badge[hidden] muss display:none setzen');
    preisLos();
    assert.ok(await warte(() => /679/.test(d.querySelector('#gallery [data-price-for="10294-1"]')?.textContent || '')));
    await ruhig();
    assert.equal(d.querySelector('#gallery img'), bild, 'die Kachelwand wurde neu gebaut');
    assert.equal(d.querySelector('#gallery [data-price-for="10294-1"]'), titanic);
    assert.equal(titanic.hidden, false);
    assert.equal(baumhaus.hidden, true, 'ohne Preis bleibt der Container verborgen');
  } finally {
    w.close();
  }
});
