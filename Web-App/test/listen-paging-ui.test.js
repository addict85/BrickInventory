/**
 * Page-wise loading of gallery, parts list and minifigures in jsdom:
 * which requests the UI makes, when it rebuilds and how it
 * appends follow-up pages. Filtering and sorting live on the server; the
 * UI only draws what it delivers.
 *
 * Counter-checks (05.11.2026, each on its own, bundle rebuilt):
 *   A  teile.js appendParts without the branch `g.color === _partsLastColor`
 *      → “parts list: a color group runs across the page boundary” red (two headings)
 *   B  sammlung.js gsort listener removed → “gallery: search, sorting …” red
 *   C  teile.js `with_sets` always set → “parts list: in_sets only in the table” red
 *   D  sammlung.js renderGallery with `list.filter(s => s.name.includes(q))`
 *      → “gallery: shows what the server delivers” red
 *   E  minifigs.js p.set('source', 'set') removed → “minifigures: source …” red
 *   F  teile.js setColorFilter without loadPartsData() → “parts list: color filter …” red
 *   G  minifigs.js loadMinifigsMore without appendFigs(batch) → “minifigures: follow-up page …” red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, switchTab } = require('./helpers/ui');

const query = url => new URL(url, 'http://x').searchParams;
const set = (nr, name) => ({ set_number: nr, name, quantity: 1 });
const part = (nr, name, color = 'Red') => ({
  part_number: nr,
  part_name: name,
  color_id: 5,
  color_name: color,
  total_quantity: 1,
  image_url: `https://cdn.rebrickable.com/media/parts/${nr}.jpg`,
});
const callsTo = (calls, path) => calls.filter(a => a.url.includes(`/api${path}?`)).map(a => query(a.url));

test('gallery: first page with page and page_size, the follow-up page is appended', async () => {
  const first = Array.from({ length: 60 }, (_, i) => set(`${1000 + i}-1`, `Set ${i}`));
  const { w, d, waitFor, calls } = await openUi({
    '/v2/sets': url =>
      query(url).get('page') === '2'
        ? { success: true, sets: [set('9999-1', 'Folge-Set')], count: 1, total: 61 }
        : { success: true, sets: first, count: 60, total: 61 },
  });
  try {
    const tile = () => d.querySelector('#gallery .sgrid > *');
    assert.ok(await waitFor(() => tile()));
    const firstTile = tile();
    assert.ok(await waitFor(() => /Folge-Set/.test(d.getElementById('gallery').textContent)));
    const [p1, p2] = callsTo(calls, '/v2/sets');
    assert.equal(p1.get('page'), '1');
    assert.equal(p1.get('page_size'), '60');
    assert.equal(p2.get('page'), '2');
    assert.equal(tile(), firstTile, 'the first page was rebuilt instead of extended');
    assert.equal(d.querySelectorAll('#gallery .sgrid > *').length, 61);
    assert.ok(
      d.getElementById('gallery-sentinel') &&
        !d.getElementById('gallery').contains(d.getElementById('gallery-sentinel')),
      'the sentinel is next to #gallery',
    );
  } finally {
    w.close();
  }
});

test('gallery: search, sorting and theme filter reload at the server', async () => {
  const { w, d, waitFor, calls } = await openUi({
    '/v2/sets': {
      success: true,
      sets: [set('10294-1', 'Titanic')],
      count: 1,
      total: 1,
      themes: ['Icons', '<b>Fett</b>'],
    },
  });
  try {
    assert.ok(await waitFor(() => d.querySelectorAll('#gtheme option').length === 3));
    assert.deepEqual(
      [...d.querySelectorAll('#gtheme option')].map(o => o.textContent),
      ['Alle Themen', 'Icons', '<b>Fett</b>'],
    );
    const n = () => callsTo(calls, '/v2/sets').length;
    const prior = n();
    d.getElementById('gs').value = 'tita';
    d.getElementById('gs').dispatchEvent(new w.Event('input'));
    assert.ok(await waitFor(() => n() > prior));
    assert.equal(callsTo(calls, '/v2/sets').at(-1).get('search'), 'tita');
    d.getElementById('gsort').value = 'name_asc';
    d.getElementById('gsort').dispatchEvent(new w.Event('change'));
    assert.ok(await waitFor(() => callsTo(calls, '/v2/sets').at(-1).get('sort') === 'name_asc'));
    d.getElementById('gtheme').value = 'Icons';
    d.getElementById('gtheme').dispatchEvent(new w.Event('change'));
    assert.ok(await waitFor(() => callsTo(calls, '/v2/sets').at(-1).get('theme') === 'Icons'));
    assert.equal(callsTo(calls, '/v2/sets').at(-1).get('sort'), 'name_asc');
  } finally {
    w.close();
  }
});

test('gallery: shows what the server delivers without filtering or sorting itself', async () => {
  const { w, d, waitFor } = await openUi({
    '/v2/sets': url =>
      query(url).get('search')
        ? { success: true, sets: [set('2-1', 'Zebra'), set('1-1', 'Affe')], count: 2, total: 2 }
        : { success: true, sets: [set('3-1', 'Start')], count: 1, total: 1 },
  });
  try {
    d.getElementById('gs').value = 'xyz';
    d.getElementById('gs').dispatchEvent(new w.Event('input'));
    assert.ok(await waitFor(() => /Zebra/.test(d.getElementById('gallery').textContent)));
    const text = d.getElementById('gallery').textContent;
    assert.ok(text.indexOf('Zebra') < text.indexOf('Affe'), 'Order of the server');
  } finally {
    w.close();
  }
});

test('parts list: pages with page_size, images as preview via the proxy', async () => {
  const { w, d, waitFor, calls } = await openUi({
    '/v2/parts': { success: true, parts: [part('3001', 'Stein 2 x 4')], total: 1, page: 1, page_size: 100 },
  });
  try {
    await switchTab(w, 'parts');
    assert.ok(await waitFor(() => d.querySelector('#parts-main .part-card img')));
    const [p] = callsTo(calls, '/v2/parts');
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

test('parts list: a color group runs across the page boundary', async () => {
  const page1 = [...Array.from({ length: 99 }, (_, i) => part(`a${i}`, `Blau ${i}`, 'Blue')), part('r1', 'Rot 1')];
  const { w, d, waitFor } = await openUi({
    '/v2/parts': url =>
      query(url).get('page') === '2'
        ? {
            success: true,
            parts: [part('r2', 'Rot 2'), part('g1', 'Grün 1', 'Green')],
            total: 102,
            page: 2,
            page_size: 100,
          }
        : { success: true, parts: page1, total: 102, page: 1, page_size: 100 },
  });
  try {
    await switchTab(w, 'parts');
    assert.ok(await waitFor(() => /Grün 1/.test(d.getElementById('parts-main').textContent)));
    const groups = [...d.querySelectorAll('#parts-main .parts-group')];
    assert.equal(groups.length, 3, 'Blue, red, green — red only once');
    const rot = groups[1];
    assert.equal(rot.querySelectorAll('.part-card').length, 2);
    assert.equal(rot.dataset.count, '2');
  } finally {
    w.close();
  }
});

test('parts list: search loads both lists, spare part and view changes rebuild', async () => {
  const { w, d, waitFor, calls } = await openUi({
    '/v2/parts': { success: true, parts: [part('3001', 'Stein')], total: 1, page: 1, page_size: 100 },
  });
  try {
    await switchTab(w, 'parts');
    assert.ok(await waitFor(() => callsTo(calls, '/v2/parts').length === 1));
    const manual = () => calls.filter(a => a.url.includes('/api/v2/parts/manual')).length;
    const m0 = manual();
    d.getElementById('parts-search').value = 'stein';
    d.getElementById('parts-search').dispatchEvent(new w.Event('input'));
    assert.ok(await waitFor(() => callsTo(calls, '/v2/parts').length === 2 && manual() > m0));
    assert.equal(callsTo(calls, '/v2/parts').at(-1).get('search'), 'stein');
    d.getElementById('parts-spare').value = '1';
    d.getElementById('parts-spare').dispatchEvent(new w.Event('change'));
    assert.ok(await waitFor(() => callsTo(calls, '/v2/parts').length === 3));
    assert.equal(callsTo(calls, '/v2/parts').at(-1).get('spare'), '1');
    d.getElementById('parts-view').value = 'table';
    d.getElementById('parts-view').dispatchEvent(new w.Event('change'));
    assert.ok(await waitFor(() => callsTo(calls, '/v2/parts').length === 4));
    assert.equal(callsTo(calls, '/v2/parts').at(-1).get('with_sets'), '1', 'in_sets only in the table');
    assert.ok(await waitFor(() => d.querySelector('#parts-main table')));
    assert.ok(
      d.getElementById('parts-sentinel') &&
        !d.getElementById('parts-main').contains(d.getElementById('parts-sentinel')),
      'the sentinel is next to #parts-main and survives the rebuild',
    );
  } finally {
    w.close();
  }
});

test('parts list: color filter rebuilds at the server', async () => {
  const { w, d, waitFor, calls } = await openUi({
    '/v2/parts': { success: true, parts: [part('3001', 'Stein')], total: 1, page: 1, page_size: 100 },
    '/v2/parts/colors': { success: true, colors: [{ color_name: 'Red', unique_parts: 1 }] },
  });
  try {
    await switchTab(w, 'parts');
    assert.ok(await waitFor(() => [...d.querySelectorAll('#parts-color option')].some(o => o.value === 'Red')));
    const n = callsTo(calls, '/v2/parts').length;
    d.getElementById('parts-color').value = 'Red';
    d.getElementById('parts-color').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await waitFor(() => callsTo(calls, '/v2/parts').length > n));
    assert.equal(callsTo(calls, '/v2/parts').at(-1).get('color'), 'Red');
  } finally {
    w.close();
  }
});

test('minifigures: source and page size go to the server, the search reloads', async () => {
  const { w, d, waitFor, calls } = await openUi({
    '/v2/minifigs': {
      success: true,
      figs: [{ fig_number: 'sw0001', name: 'Luke', quantity: 1, source: 'set' }],
      total: 1,
    },
  });
  try {
    await switchTab(w, 'minifigs');
    assert.ok(await waitFor(() => callsTo(calls, '/v2/minifigs').length >= 1));
    const [p] = callsTo(calls, '/v2/minifigs');
    assert.equal(p.get('source'), 'set');
    assert.equal(p.get('page'), '1');
    assert.equal(p.get('page_size'), '60');
    const n = callsTo(calls, '/v2/minifigs').length;
    d.getElementById('fig-search').value = 'luke';
    d.getElementById('fig-search').dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.ok(await waitFor(() => callsTo(calls, '/v2/minifigs').length > n));
    assert.equal(callsTo(calls, '/v2/minifigs').at(-1).get('search'), 'luke');
  } finally {
    w.close();
  }
});

test('minifigures: the follow-up page is appended, not rebuilt', async () => {
  const fig = (nr, name) => ({ fig_number: nr, name, quantity: 1, source: 'set' });
  const first = Array.from({ length: 60 }, (_, i) => fig(`sw${1000 + i}`, `Figur ${i}`));
  const { w, d, waitFor } = await openUi({
    '/v2/minifigs': url =>
      query(url).get('page') === '2'
        ? { success: true, figs: [fig('sw9999', 'Folge-Figur')], total: 61 }
        : { success: true, figs: first, total: 61 },
  });
  try {
    await switchTab(w, 'minifigs');
    assert.ok(await waitFor(() => /sw1000/.test(d.getElementById('figs-list').textContent)));
    const firstNode = d.querySelector(
      '#figs-list :is(.parts-grid, .man-grid, .figs-grid, .sgrid) > *, #figs-list .dt tbody tr',
    );
    assert.ok(await waitFor(() => /sw9999/.test(d.getElementById('figs-list').textContent)));
    assert.ok(firstNode && d.getElementById('figs-list').contains(firstNode), 'the first page was rebuilt');
    assert.ok(
      !d.getElementById('figs-list').contains(d.getElementById('figs-sentinel')),
      'the sentinel is next to the list',
    );
  } finally {
    w.close();
  }
});
