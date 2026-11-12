/**
 * „Verwendet in" zeigt Bild, Nummer und Bezeichnung — in BEIDEN Oberflächen.
 * Die Webapp im echten Bündel (jsdom); die App liest Kotlin (Struktur, kein SDK hier).
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, Bündel neu gebaut), alle in
 * set-teile.js → rot „die Webapp zeigt die Sets als Tabelle …“:
 *   A  die Bildzelle `${setBild(s)}` geleert
 *   B  zeilenStil 'flex-direction:column…' entfernt (Tabelle neben der Beschriftung)
 *   C  `orig:` aus bildTag entfernt (kein Rückfall auf das CDN-Bild)
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

const ohneKommentare = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');

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
  const o = await oeffneOberflaeche({
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

test('die App zeigt dieselben drei Spalten', () => {
  const datei = path.join(
    __dirname,
    '..',
    '..',
    'Android-App',
    'feature-teile',
    'src',
    'main',
    'java',
    'ch',
    'brickinventoryapp',
    'teile',
    'ui',
    'dialogs',
    'SetItemDetailDialog.kt',
  );
  assert.ok(fs.existsSync(datei), `${datei} nicht gefunden`);
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));

  // Warum hier NICHT resolveThumbUrl steht
  assert.match(
    src,
    /rememberTileImageWithFallback\(serverUrl, s\.imageLocal, s\.imageUrl\)/,
    'Die App löst das Set-Bild nicht als Vorschau mit Rückfall auf — die Zeile ' +
      'bliebe ohne Bild, wo die Webapp über data-orig nachlädt',
  );

  // Und dieselbe Zeile wie die Tabellenansicht, nicht eine zweite, die ihr
  // aehnelt: „so wie im Reiter Finanzen" war die Vorgabe, und zwei Fassungen
  // derselben Zeile entwickeln sich auseinander.
  assert.match(
    src,
    /TabellenZeile\(/,
    'Der Dialog baut die Set-Zeile selbst, statt die gemeinsame TabellenZeile ' +
      'zu nehmen — dann sieht sie nur so lange gleich aus, bis eine der beiden ' +
      'geändert wird',
  );

  for (const feld of ['s.setNumber', 's.setName']) assert.ok(src.includes(feld), `${feld} fehlt in der Zeile der App`);
});
