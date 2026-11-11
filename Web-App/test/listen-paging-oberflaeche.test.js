/**
 * Seitenweises Laden von Galerie, Teileliste und Minifiguren in jsdom:
 * welche Anfragen die Oberfläche stellt, wann sie neu aufbaut und wie sie
 * Folgeseiten anhängt. Filtern und Sortieren liegen auf dem Server; die
 * Oberfläche zeichnet nur, was er liefert.
 *
 * Gegenproben (05.11.2026, je einzeln, Bündel neu gebaut):
 *   A  parts.js appendParts ohne den Zweig `g.color === _partsLastColor`
 *      → „Teileliste: eine Farbgruppe läuft über die Seitengrenze“ rot (zwei Überschriften)
 *   B  gallery.js gsort-Listener entfernt → „Galerie: Suche, Sortierung …“ rot
 *   C  parts.js `with_sets` immer gesetzt → „Teileliste: in_sets nur in der Tabelle“ rot
 *   D  gallery.js renderGallery mit `list.filter(s => s.name.includes(q))`
 *      → „Galerie: zeigt, was der Server liefert“ rot
 *   E  minifigs.js p.set('source', 'set') entfernt → „Minifiguren: Quelle …“ rot
 *   F  parts.js setColorFilter ohne loadPartsData() → „Teileliste: Farbfilter …“ rot
 *   G  minifigs.js loadMinifigsMore ohne appendFigs(batch) → „Minifiguren: Folgeseite …“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter } = require('./helpers/oberflaeche');

const abfrage = url => new URL(url, 'http://x').searchParams;
const set = (nr, name) => ({ set_number: nr, name, quantity: 1 });
const teil = (nr, name, farbe = 'Red') => ({
  part_number: nr,
  part_name: name,
  color_id: 5,
  color_name: farbe,
  total_quantity: 1,
  image_url: `https://cdn.rebrickable.com/media/parts/${nr}.jpg`,
});
const aufrufeZu = (aufrufe, pfad) => aufrufe.filter(a => a.url.includes(`/api${pfad}?`)).map(a => abfrage(a.url));

test('Galerie: erste Seite mit page und page_size, Folgeseite wird angehängt', async () => {
  const erste = Array.from({ length: 60 }, (_, i) => set(`${1000 + i}-1`, `Set ${i}`));
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/sets': url =>
      abfrage(url).get('page') === '2'
        ? { success: true, sets: [set('9999-1', 'Folge-Set')], count: 1, total: 61 }
        : { success: true, sets: erste, count: 60, total: 61 },
  });
  try {
    const kachel = () => d.querySelector('#gallery .sgrid > *');
    assert.ok(await warte(() => kachel()));
    const ersteKachel = kachel();
    assert.ok(await warte(() => /Folge-Set/.test(d.getElementById('gallery').textContent)));
    const [p1, p2] = aufrufeZu(aufrufe, '/v1/sets');
    assert.equal(p1.get('page'), '1');
    assert.equal(p1.get('page_size'), '60');
    assert.equal(p2.get('page'), '2');
    assert.equal(kachel(), ersteKachel, 'die erste Seite wurde neu gebaut statt ergänzt');
    assert.equal(d.querySelectorAll('#gallery .sgrid > *').length, 61);
    assert.ok(
      d.getElementById('gallery-sentinel') &&
        !d.getElementById('gallery').contains(d.getElementById('gallery-sentinel')),
      'der Sentinel liegt neben #gallery',
    );
  } finally {
    w.close();
  }
});

test('Galerie: Suche, Sortierung und Themenfilter laden neu beim Server', async () => {
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/sets': {
      success: true,
      sets: [set('10294-1', 'Titanic')],
      count: 1,
      total: 1,
      themes: ['Icons', '<b>Fett</b>'],
    },
  });
  try {
    assert.ok(await warte(() => d.querySelectorAll('#gtheme option').length === 3));
    assert.deepEqual(
      [...d.querySelectorAll('#gtheme option')].map(o => o.textContent),
      ['Alle Themen', 'Icons', '<b>Fett</b>'],
    );
    const n = () => aufrufeZu(aufrufe, '/v1/sets').length;
    const vorher = n();
    d.getElementById('gs').value = 'tita';
    d.getElementById('gs').dispatchEvent(new w.Event('input'));
    assert.ok(await warte(() => n() > vorher));
    assert.equal(aufrufeZu(aufrufe, '/v1/sets').at(-1).get('search'), 'tita');
    d.getElementById('gsort').value = 'name_asc';
    d.getElementById('gsort').dispatchEvent(new w.Event('change'));
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/sets').at(-1).get('sort') === 'name_asc'));
    d.getElementById('gtheme').value = 'Icons';
    d.getElementById('gtheme').dispatchEvent(new w.Event('change'));
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/sets').at(-1).get('theme') === 'Icons'));
    assert.equal(aufrufeZu(aufrufe, '/v1/sets').at(-1).get('sort'), 'name_asc');
  } finally {
    w.close();
  }
});

test('Galerie: zeigt, was der Server liefert, ohne selbst zu filtern oder zu sortieren', async () => {
  const { w, d, warte } = await oeffneOberflaeche({
    '/v1/sets': url =>
      abfrage(url).get('search')
        ? { success: true, sets: [set('2-1', 'Zebra'), set('1-1', 'Affe')], count: 2, total: 2 }
        : { success: true, sets: [set('3-1', 'Start')], count: 1, total: 1 },
  });
  try {
    d.getElementById('gs').value = 'xyz';
    d.getElementById('gs').dispatchEvent(new w.Event('input'));
    assert.ok(await warte(() => /Zebra/.test(d.getElementById('gallery').textContent)));
    const text = d.getElementById('gallery').textContent;
    assert.ok(text.indexOf('Zebra') < text.indexOf('Affe'), 'Reihenfolge des Servers');
  } finally {
    w.close();
  }
});

test('Teileliste: Seiten mit page_size, Bilder als Vorschau über den Proxy', async () => {
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/parts': { success: true, parts: [teil('3001', 'Stein 2 x 4')], total: 1, page: 1, page_size: 100 },
  });
  try {
    await reiter(w, 'parts');
    assert.ok(await warte(() => d.querySelector('#parts-main .part-card img')));
    const [p] = aufrufeZu(aufrufe, '/v1/parts');
    assert.equal(p.get('page'), '1');
    assert.equal(p.get('page_size'), '100');
    assert.equal(p.get('with_sets'), null);
    const src = d.querySelector('#parts-main .part-card img').getAttribute('src');
    assert.match(src, /^\/api\/v1\/img-proxy\?.*thumb=1/);
    assert.equal(d.querySelector('#parts-main .part-card img').getAttribute('loading'), 'lazy');
  } finally {
    w.close();
  }
});

test('Teileliste: eine Farbgruppe läuft über die Seitengrenze', async () => {
  const seite1 = [...Array.from({ length: 99 }, (_, i) => teil(`a${i}`, `Blau ${i}`, 'Blue')), teil('r1', 'Rot 1')];
  const { w, d, warte } = await oeffneOberflaeche({
    '/v1/parts': url =>
      abfrage(url).get('page') === '2'
        ? {
            success: true,
            parts: [teil('r2', 'Rot 2'), teil('g1', 'Grün 1', 'Green')],
            total: 102,
            page: 2,
            page_size: 100,
          }
        : { success: true, parts: seite1, total: 102, page: 1, page_size: 100 },
  });
  try {
    await reiter(w, 'parts');
    assert.ok(await warte(() => /Grün 1/.test(d.getElementById('parts-main').textContent)));
    const gruppen = [...d.querySelectorAll('#parts-main .parts-group')];
    assert.equal(gruppen.length, 3, 'Blau, Rot, Grün — Rot nur einmal');
    const rot = gruppen[1];
    assert.equal(rot.querySelectorAll('.part-card').length, 2);
    assert.equal(rot.dataset.count, '2');
  } finally {
    w.close();
  }
});

test('Teileliste: Suche lädt beide Listen, Ersatzteil- und Ansichtswechsel bauen neu auf', async () => {
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/parts': { success: true, parts: [teil('3001', 'Stein')], total: 1, page: 1, page_size: 100 },
  });
  try {
    await reiter(w, 'parts');
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/parts').length === 1));
    const manuell = () => aufrufe.filter(a => a.url.includes('/api/v1/parts/manual')).length;
    const m0 = manuell();
    d.getElementById('parts-search').value = 'stein';
    d.getElementById('parts-search').dispatchEvent(new w.Event('input'));
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/parts').length === 2 && manuell() > m0));
    assert.equal(aufrufeZu(aufrufe, '/v1/parts').at(-1).get('search'), 'stein');
    d.getElementById('parts-spare').value = '1';
    d.getElementById('parts-spare').dispatchEvent(new w.Event('change'));
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/parts').length === 3));
    assert.equal(aufrufeZu(aufrufe, '/v1/parts').at(-1).get('spare'), '1');
    d.getElementById('parts-view').value = 'table';
    d.getElementById('parts-view').dispatchEvent(new w.Event('change'));
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/parts').length === 4));
    assert.equal(aufrufeZu(aufrufe, '/v1/parts').at(-1).get('with_sets'), '1', 'in_sets nur in der Tabelle');
    assert.ok(await warte(() => d.querySelector('#parts-main table')));
    assert.ok(
      d.getElementById('parts-sentinel') &&
        !d.getElementById('parts-main').contains(d.getElementById('parts-sentinel')),
      'der Sentinel liegt neben #parts-main und überlebt den Neuaufbau',
    );
  } finally {
    w.close();
  }
});

test('Teileliste: Farbfilter baut beim Server neu auf', async () => {
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/parts': { success: true, parts: [teil('3001', 'Stein')], total: 1, page: 1, page_size: 100 },
    '/v1/parts/colors': { success: true, colors: [{ color_name: 'Red', unique_parts: 1 }] },
  });
  try {
    await reiter(w, 'parts');
    assert.ok(await warte(() => [...d.querySelectorAll('#parts-color option')].some(o => o.value === 'Red')));
    const n = aufrufeZu(aufrufe, '/v1/parts').length;
    d.getElementById('parts-color').value = 'Red';
    d.getElementById('parts-color').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/parts').length > n));
    assert.equal(aufrufeZu(aufrufe, '/v1/parts').at(-1).get('color'), 'Red');
  } finally {
    w.close();
  }
});

test('Minifiguren: Quelle und Seitengrösse gehen an den Server, die Suche lädt neu', async () => {
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/minifigs': {
      success: true,
      figs: [{ fig_number: 'sw0001', name: 'Luke', quantity: 1, source: 'set' }],
      total: 1,
    },
  });
  try {
    await reiter(w, 'minifigs');
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/minifigs').length >= 1));
    const [p] = aufrufeZu(aufrufe, '/v1/minifigs');
    assert.equal(p.get('source'), 'set');
    assert.equal(p.get('page'), '1');
    assert.equal(p.get('page_size'), '60');
    const n = aufrufeZu(aufrufe, '/v1/minifigs').length;
    d.getElementById('fig-search').value = 'luke';
    d.getElementById('fig-search').dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.ok(await warte(() => aufrufeZu(aufrufe, '/v1/minifigs').length > n));
    assert.equal(aufrufeZu(aufrufe, '/v1/minifigs').at(-1).get('search'), 'luke');
  } finally {
    w.close();
  }
});

test('Minifiguren: Folgeseite wird angehängt, nicht neu gebaut', async () => {
  const fig = (nr, name) => ({ fig_number: nr, name, quantity: 1, source: 'set' });
  const erste = Array.from({ length: 60 }, (_, i) => fig(`sw${1000 + i}`, `Figur ${i}`));
  const { w, d, warte } = await oeffneOberflaeche({
    '/v1/minifigs': url =>
      abfrage(url).get('page') === '2'
        ? { success: true, figs: [fig('sw9999', 'Folge-Figur')], total: 61 }
        : { success: true, figs: erste, total: 61 },
  });
  try {
    await reiter(w, 'minifigs');
    assert.ok(await warte(() => /sw1000/.test(d.getElementById('figs-list').textContent)));
    const ersterKnoten = d.querySelector(
      '#figs-list :is(.parts-grid, .man-grid, .figs-grid, .sgrid) > *, #figs-list .dt tbody tr',
    );
    assert.ok(await warte(() => /sw9999/.test(d.getElementById('figs-list').textContent)));
    assert.ok(ersterKnoten && d.getElementById('figs-list').contains(ersterKnoten), 'die erste Seite wurde neu gebaut');
    assert.ok(
      !d.getElementById('figs-list').contains(d.getElementById('figs-sentinel')),
      'der Sentinel liegt neben der Liste',
    );
  } finally {
    w.close();
  }
});
