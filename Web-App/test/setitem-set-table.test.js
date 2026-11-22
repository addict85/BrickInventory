/**
 * „Verwendet in" shows image, number and name (as in the app).
 * The web app in the real bundle (jsdom).
 *
 * Counter-checks (measured 10.11.2026, each on its own, bundle rebuilt), all in
 * set-teile.js → red “the web app shows the sets as a table …”:
 *   A  the image cell `${setBild(s)}` emptied
 *   B  rowsStyle 'flex-direction:column…' removed (table next to the label)
 *   C  `orig:` removed from imageTag (no fallback to the CDN image)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { openUi, warte } = require('./helpers/ui');

test('the web app shows the sets as a table with image, number and name, below the label', async () => {
  const SETS = [
    {
      set_number: '10305-1',
      set_name: 'Löwenritterburg',
      quantity: 4,
      image_local: '/images/sets/10305-1.jpg',
      image_url: 'https://cdn.rebrickable.com/media/sets/10305-1.jpg',
    },
    { set_number: '6080-1', set_name: 'Königsburg', quantity: 1, image_local: null, image_url: null },
  ];
  const o = await openUi({
    '/v1/parts/3001/5/sets': {
      success: true,
      item: { name: 'Stein 2 x 4', color_name: 'Red', total_quantity: 5, owner_ids: [1] },
      sets: SETS,
    },
  });
  try {
    await o.ruhig();
    const knopf = o.d.createElement('button');
    Object.assign(knopf.dataset, { click: 'openSetItemDetail', arg: 'part', arg2: '3001', arg3: '5' });
    o.d.body.append(knopf);
    knopf.click();
    await warte(() => o.d.querySelector('#setitem-body table'));
    const tabelle = o.d.querySelector('#setitem-body table');
    const zeilen = [...tabelle.querySelectorAll('tbody tr')];
    assert.equal(zeilen.length, 2);
    const text = zeilen.map(z => [...z.cells].map(c => c.textContent.trim()));
    assert.deepEqual(
      text.map(z => z.slice(1, 3)),
      [
        ['10305-1', 'Löwenritterburg'],
        ['6080-1', 'Königsburg'],
      ],
    );
    const bild = zeilen[0].cells[0].querySelector('img');
    assert.ok(bild, 'das erste Set hat kein Bild');
    assert.match(bild.getAttribute('src'), /\/images\/sets\/10305-1\.jpg$/, 'das lokale Bild fehlt');
    assert.match(bild.dataset.orig ?? '', /10305-1\.jpg/, 'ohne data-orig kein Rückfall auf das CDN-Bild');
    assert.ok(zeilen[1].cells[0].querySelector('.image-ph'), 'ein Set ohne Bild zeigt keinen Platzhalter');
    const zeile = tabelle.closest('.dr');
    assert.equal(zeile.style.flexDirection, 'column', 'die Tabelle steht neben der Beschriftung');
  } finally {
    o.w.close();
  }
});
