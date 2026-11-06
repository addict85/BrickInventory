/**
 * Kein Bild bekommt ein leeres `src`: Der Browser löste es gegen die Adresse
 * der Seite auf, lüde sie als Bild und der Fehlerlauscher meldete das in der
 * Konsole. Beobachtet wird in jsdom jede Änderung eines src-Attributs, beim
 * Start, beim Wiederholversuch nach einem Ladefehler und beim Zoom.
 *
 * Gegenproben (05.11.2026, je einzeln, Bündel neu gebaut):
 *   A  closeImageLightbox() mit `G('lightbox-img').src = ''` → „Zoom schliessen …“ rot
 *   B  11-actions.js Wiederholversuch mit `el.src = ''` statt removeAttribute
 *      → „ein Ladefehler …“ rot
 *   C  `<img id="lightbox-img" src="">` in index.html → „beim Start …“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche } = require('./helpers/oberflaeche');

/** Öffnet die Oberfläche und zeichnet jedes leere src auf, auch das aus dem Markup. */
async function mitBeobachter(antworten = {}) {
  const leer = [];
  const o = await oeffneOberflaeche(antworten, {
    vorher(w) {
      new w.MutationObserver(ms => {
        for (const m of ms) {
          const ziel = /** @type {any} */ (m.target);
          // oldValue fängt auch ein leeres src, das im selben Takt wieder überschrieben wurde.
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

test('beim Start und in der Galerie hat kein Bild ein leeres src', async () => {
  const { w, d, warte, leer } = await mitBeobachter({
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

test('ein Ladefehler wiederholt ohne leeres src', async () => {
  const { w, d, warte, leer } = await mitBeobachter({
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
    // Der Wiederholversuch nimmt die Adresse nach einer Sekunde weg und setzt sie neu.
    assert.ok(await warte(() => wechsel >= 2, 3000), 'kein Wiederholversuch');
    assert.equal(img.src, vorher);
    assert.deepEqual(leer, []);
  } finally {
    w.close();
  }
});

test('Zoom schliessen entfernt das Bild, statt src zu leeren', async () => {
  const { w, d, leer } = await mitBeobachter();
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
