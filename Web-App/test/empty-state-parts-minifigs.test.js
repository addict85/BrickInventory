/**
 * Parts and minifigures tabs: an empty state only appears when BOTH
 * sources are empty, and color/category appear as select fields in the
 * filter bar above the lists. Checked on the real bundle in jsdom with
 * predefined server responses (test/helpers/ui.js).
 *
 * Counter-checks (measured on 28.10.):
 *   A  in teile.js the old empty state of the set parts drawn unconditionally again
 *      → red: “parts: manual present, from sets empty" and “both empty"
 *   B  in reconcileMinifigsEmpty() (minifigs.js) the exception for existing
 *      manual minifigures removed → red: “minifigures: manual present, from sets empty"
 *   C  partFitsToFilter() always true → red: “color filter … acts on both lists"
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const ROT = {
  part_number: '3001',
  part_name: 'Brick 2 x 4',
  color_id: 4,
  color_name: 'Red',
  color_hex: 'C91A09',
  quantity: 2,
  conditions: ['U'],
  category_name: '11',
};
const BLUE = {
  part_number: '3002',
  part_name: 'Brick 2 x 2',
  color_id: 1,
  color_name: 'Blue',
  color_hex: '0055BF',
  quantity: 1,
  conditions: ['N'],
  category_name: '11',
};
const FIGUR = { fig_number: 'fig-000123', fig_name: 'Chewbacca', quantity: 1, conditions: ['N'] };
const SETTEIL = {
  part_number: '3020',
  part_name: 'Plate 2 x 4',
  color_name: 'Red',
  color_hex: 'C91A09',
  color_id: 4,
  total_quantity: 3,
};

const text = el => (el?.textContent || '').replace(/\s+/g, ' ');
const sichtbar = el => !!el && el.style.display !== 'none';

async function parts(antworten) {
  const o = await openUi(antworten);
  await reiter(o.w, 'parts');
  await warte(() => !o.d.querySelector('#parts-main .loading, #parts-main .lade'), 3000);
  await o.ruhig();
  return o;
}

test('parts: manual ones there, from sets empty — no empty state', async () => {
  const { w, d } = await parts({ '/v2/parts/manual': { success: true, parts: [ROT] } });
  try {
    assert.equal(d.querySelectorAll('#manual-parts-list .man-tile').length, 1);
    assert.ok(sichtbar(d.getElementById('manual-parts-box')));
    assert.ok(
      !text(d.getElementById('tab-parts')).includes('Noch keine Teile'),
      'Unter einer Liste mit Einträgen steht „Noch keine Teile"',
    );
  } finally {
    w.close();
  }
});

test('parts: both empty — exactly one empty state, the empty box disappears', async () => {
  const { w, d } = await parts({});
  try {
    const leer = d.querySelectorAll('#tab-parts .empty-state');
    assert.equal(leer.length, 1, `${leer.length} Leerzustände`);
    assert.ok(text(leer[0]).includes('Noch keine Teile'));
    assert.ok(
      d.querySelector('#tab-parts .capture-bar [data-click="openCapture"][data-arg="part"]'),
      'Die Leiste bietet das Erfassen an',
    );
    // The same icon as the “parts" tab — not a puzzle piece.
    assert.equal(
      leer[0].querySelector('.empty-ico use')?.getAttribute('href'),
      d.querySelector('.collection-choice [data-arg="parts"] use')?.getAttribute('href'),
    );
    assert.equal(sichtbar(d.getElementById('manual-parts-box')), false);
  } finally {
    w.close();
  }
});

test('parts: only from sets — no empty box for manual ones', async () => {
  const { w, d } = await parts({ '/v2/parts': { success: true, parts: [SETTEIL], total: 1 } });
  try {
    assert.equal(d.querySelectorAll('#parts-main .part-card').length, 1);
    assert.equal(sichtbar(d.getElementById('manual-parts-box')), false);
    assert.equal(d.querySelectorAll('#tab-parts .empty-state').length, 0);
  } finally {
    w.close();
  }
});

test('the color filter stands above the lists and acts on both lists', async () => {
  const { w, d, aufrufe, ruhig } = await parts({ '/v2/parts/manual': { success: true, parts: [ROT, BLUE] } });
  try {
    const wahl = d.getElementById('parts-color');
    assert.ok(sichtbar(wahl), 'Das Farbfeld ist verborgen, obwohl es zwei Farben gibt');
    assert.ok(
      wahl.compareDocumentPosition(d.getElementById('manual-parts-box')) & w.Node.DOCUMENT_POSITION_FOLLOWING,
      'Der Farbfilter steht nicht über den Listen',
    );
    // The value stays English (that is how it is in the data), the label is translated.
    assert.deepEqual(
      [...wahl.options].map(o => o.value),
      ['', 'Red', 'Blue'],
    );
    assert.deepEqual(
      [...wahl.options].map(o => o.textContent),
      ['Alle Farben', 'Rot', 'Blau'],
    );
    wahl.value = 'Blue';
    wahl.dispatchEvent(new w.Event('change', { bubbles: true }));
    await ruhig();
    const namen = [...d.querySelectorAll('#manual-parts-list .man-tile-name')].map(text);
    assert.deepEqual(namen, ['Brick 2 x 2'], 'Farbfilter wirkt auf beide Listen');
    assert.ok(
      aufrufe.some(a => a.url.includes('/v2/parts?') && a.url.includes('color=Blue')),
      'Die Teile aus Sets werden nicht nach der Farbe gefragt',
    );
  } finally {
    w.close();
  }
});

async function minifigs(antworten) {
  const o = await openUi(antworten);
  await reiter(o.w, 'minifigs');
  await o.ruhig();
  return o;
}

test('figures: manual ones there, from sets empty — no empty state', async () => {
  const { w, d } = await minifigs({ '/v2/minifigs/manual': { success: true, figs: [FIGUR] } });
  try {
    assert.equal(d.querySelectorAll('#manual-figs-list .man-tile').length, 1);
    assert.ok(
      !text(d.getElementById('tab-minifigs')).includes('Noch keine Minifiguren'),
      'Unter einer Liste mit Einträgen steht „Noch keine Minifiguren"',
    );
  } finally {
    w.close();
  }
});

test('figures: both empty — exactly one empty state', async () => {
  const { w, d } = await minifigs({});
  try {
    const leer = d.querySelectorAll('#tab-minifigs .empty-state');
    assert.equal(leer.length, 1, `${leer.length} Leerzustände`);
    assert.ok(text(leer[0]).includes('Noch keine Minifiguren'));
    assert.equal(sichtbar(d.getElementById('manual-figs-box')), false);
  } finally {
    w.close();
  }
});
