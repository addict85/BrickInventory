/**
 * No image gets an empty `src`: the browser resolved it against the page's
 * address, loaded it as an image and the error listener reported that in the
 * console. Every change of an src attribute is observed in jsdom, at
 * startup, at the retry after a loading error and at zoom.
 *
 * Counter-checks (05.11.2026, each alone, bundle rebuilt):
 *   A  closeImageLightbox() with `G('lightbox-img').src = ''` → “close zoom …” red
 *   B  aktionen.js retry with `el.src = ''` instead of removeAttribute
 *      → “a loading error …” red
 *   C  `<img id="lightbox-img" src="">` in index.html → “at startup …” red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi } = require('./helpers/ui');

/** Opens the UI and records every empty src, also the one from the markup. */
async function withObserver(antworten = {}) {
  const leer = [];
  const o = await openUi(antworten, {
    before(w) {
      new w.MutationObserver(ms => {
        for (const m of ms) {
          const ziel = /** @type {any} */ (m.target);
          // oldValue also catches an empty src that was overwritten again in the same tick.
          if (
            m.type === 'attributes' &&
            ziel.tagName === 'IMG' &&
            (ziel.getAttribute('src') === '' || m.oldValue === '')
          )
            leer.push(ziel.outerHTML.slice(0, 120));
          for (const n of m.addedNodes || [])
            for (const img of n.querySelectorAll ? [n, ...n.querySelectorAll('img')] : [])
              if (img.tagName === 'IMG' && img.getAttribute('src') === '') leer.push(img.outerHTML.slice(0, 120));
        }
      }).observe(w.document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['src'],
      });
    },
  });
  for (const img of o.d.querySelectorAll('img'))
    if (img.getAttribute('src') === '') leer.push(img.outerHTML.slice(0, 120));
  return { ...o, leer };
}

test('at startup and in the gallery no image has an empty src', async () => {
  const { w, d, warte, leer } = await withObserver({
    '/v1/sets': {
      success: true,
      sets: [
        {
          set_number: '10294-1',
          name: 'Titanic',
          quantity: 1,
          image_url: 'https://cdn.rebrickable.com/media/sets/10294-1.jpg',
        },
      ],
      count: 1,
      total: 1,
    },
  });
  try {
    assert.ok(await warte(() => d.querySelector('#gallery img')));
    assert.ok(d.querySelectorAll('img').length >= 5, 'greift die Suche noch?');
    assert.deepEqual(leer, []);
  } finally {
    w.close();
  }
});

test('a load error retries without an empty src', async () => {
  const { w, d, warte, leer } = await withObserver({
    '/v1/sets': {
      success: true,
      sets: [
        {
          set_number: '10294-1',
          name: 'Titanic',
          quantity: 1,
          image_url: 'https://cdn.rebrickable.com/media/sets/10294-1.jpg',
        },
      ],
      count: 1,
      total: 1,
    },
  });
  try {
    assert.ok(await warte(() => d.querySelector('#gallery img[src]')));
    const img = d.querySelector('#gallery img[src]');
    const vorher = img.src;
    let wechsel = 0;
    new w.MutationObserver(ms => {
      wechsel += ms.length;
    }).observe(img, { attributes: true, attributeFilter: ['src'] });
    img.dispatchEvent(new w.Event('error'));
    assert.equal(img.dataset.retried, '1');
    // The retry removes the address after one second and sets it anew.
    assert.ok(await warte(() => wechsel >= 2, 3000), 'kein Wiederholversuch');
    assert.equal(img.src, vorher);
    assert.deepEqual(leer, []);
  } finally {
    w.close();
  }
});

test('closing the zoom removes the image instead of clearing src', async () => {
  const { w, d, leer } = await withObserver();
  try {
    const bild = d.getElementById('lightbox-img');
    bild.setAttribute('src', '/api/v1/img-proxy?url=x');
    d.getElementById('img-lightbox').classList.add('open');
    d.querySelector('#img-lightbox [data-click="closeImageLightbox"]').click();
    assert.equal(d.getElementById('img-lightbox').classList.contains('open'), false);
    assert.equal(bild.hasAttribute('src'), false);
    assert.deepEqual(leer, []);
  } finally {
    w.close();
  }
});
