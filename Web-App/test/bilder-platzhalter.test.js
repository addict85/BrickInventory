/**
 * Jedes Bild aus einer Vorlage hat ein alt und den einheitlichen Platzhalter:
 * Lädt es nicht, steht dort dieselbe getönte Fläche wie bei einem Eintrag ohne
 * Bild — nicht das Browser-Symbol für kaputte Bilder. Geprüft am echten Bündel
 * in jsdom; der Fehler wird als error-Ereignis am Bild ausgelöst, wie der
 * Browser es tut (erst Wiederholung, dann Originalgrösse, dann Platzhalter).
 *
 * Gegenproben (am 28.10. gemessen):
 *   A  in 11-actions.js statt bildPlatzhalter() wieder removeAttribute('src')
 *      → rot: „Galerie: kaputtes Bild wird zum Platzhalter"
 *   B  in bildTag() (01-core.js) das alt weggelassen → rot: „alt an jedem Bild"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte, takt } = require('./helpers/oberflaeche');

const BILD = '/images/sets/10294-1.jpg';
const SETS = [{ set_number: '10294-1', name: 'Titanic', year: 2021, quantity: 1, image_local: BILD, conditions: ['N'], instructions: [] }];
const TEILE = [{ part_number: '3001', part_name: 'Brick 2 x 4', color_id: 4, color_name: 'Red', color_hex: 'C91A09', quantity: 2, conditions: ['U'], image_local: '/images/parts/3001.png' }];
const FIGUREN = [{ fig_number: 'fig-000123', fig_name: 'Chewbacca', quantity: 1, conditions: ['N'], image_local: '/images/figs/fig-000123.png' }];
const SET_TEILE = [{ part_number: '3020', part_name: 'Plate 2 x 4', color_name: 'Red', color_hex: 'C91A09', color_id: 4, total_quantity: 3, image_local: '/images/parts/3020.png' }];

const ANTWORTEN = {
  '/v1/sets': { success: true, sets: SETS, total: 1, themes: [] },
  '/v1/parts/manual': { success: true, parts: TEILE },
  '/v1/parts': { success: true, parts: SET_TEILE, total: 1 },
  '/v1/minifigs/manual': { success: true, figs: FIGUREN },
  '/v1/minifigs': { success: true, figs: [{ ...FIGUREN[0], source: 'set', total_quantity: 1 }], total: 1 },
  '/v1/finance/valuation': { success: true, currency: 'EUR', totals: { min: '0', avg: '0', max: '0' },
    sets: [{ ...SETS[0], purchase_price: 629, avg_price: 0, total_avg: '0' }] },
  '/v1/finance/parts-valuation': { success: true, currency: 'EUR', total_value: '0', parts: TEILE },
};

/** Alle <img> eines Bereichs, die aus Vorlagen stammen. */
const bilder = (d, sel) => [...d.querySelectorAll(`${sel} img`)];

test('alt an jedem Bild und der Platzhalter-Weg an jedem Vorlagenbild', async () => {
  const { w, d } = await oeffneOberflaeche(ANTWORTEN);
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
    assert.equal(d.querySelector('#gallery .sc img').getAttribute('alt'), 'Titanic', 'Die Kachel nennt das Set nicht');
    d.getElementById('vl').click(); await takt(30);
    pruefe('Galerie-Tabelle', '#gallery');
    d.getElementById('vg').click(); await takt(30);

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
  } finally { w.close(); }
});

test('Galerie: kaputtes Bild wird zum Platzhalter', async () => {
  const { w, d } = await oeffneOberflaeche(ANTWORTEN);
  try {
    await warte(() => d.querySelector('#gallery .sc img'));
    const img = d.querySelector('#gallery .sc img');
    const fehler = () => img.dispatchEvent(new w.Event('error'));
    fehler();                    // 1. Versuch: Wiederholung in einer Sekunde
    fehler();                    // 2. Versuch: volle Auflösung (data-orig)
    fehler();                    // 3. Versuch: Platzhalter
    await takt(10);
    const sci = d.querySelector('#gallery .sc .sci');
    assert.equal(sci.querySelector('img[data-onerror]'), null, 'Das kaputte Bild steht noch da');
    const ph = sci.querySelector('.bild-ph');
    assert.ok(ph, 'Kein Platzhalter an seiner Stelle');
    assert.equal(ph.getAttribute('role'), 'img');
    assert.equal(ph.getAttribute('aria-label'), 'Titanic');
    assert.equal(ph.querySelector('img')?.getAttribute('src'), '/assets/set-placeholder.svg',
      'Nicht derselbe Platzhalter wie für ein Set ohne Bild');
  } finally { w.close(); }
});
