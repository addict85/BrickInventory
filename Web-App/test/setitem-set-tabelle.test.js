/**
 * „Verwendet in" zeigt Bild, Nummer und Bezeichnung (wie in der App).
 * Die Webapp im echten Bündel (jsdom).
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, Bündel neu gebaut), alle in
 * set-teile.js → rot „die Webapp zeigt die Sets als Tabelle …“:
 *   A  die Bildzelle `${setBild(s)}` geleert
 *   B  rowsStyle 'flex-direction:column…' entfernt (Tabelle neben der Beschriftung)
 *   C  `orig:` aus bildTag entfernt (kein Rückfall auf das CDN-Bild)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { openUi, warte } = require('./helpers/oberflaeche');

test('die Webapp zeigt die Sets als Tabelle mit Bild, Nummer und Name, unter der Beschriftung', async () => {
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
    assert.ok(zeilen[1].cells[0].querySelector('.bild-ph'), 'ein Set ohne Bild zeigt keinen Platzhalter');
    const zeile = tabelle.closest('.dr');
    assert.equal(zeile.style.flexDirection, 'column', 'die Tabelle steht neben der Beschriftung');
  } finally {
    o.w.close();
  }
});
