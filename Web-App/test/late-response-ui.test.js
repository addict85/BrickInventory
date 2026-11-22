/**
 * Late responses of a discarded filter combination do not land in the
 * list: gallery (sammlung.js) and parts list (teile.js) increment a
 * generation and discard what belongs to an older one. In jsdom with a
 * held-back first response that only arrives after the second.
 *
 * Counter-checks (05.11.2026, each alone, mutations of the review report):
 *   A  teile.js `if (gen !== _partsGen) { _partsLoading = false; return; }`
 *      without `return` → “parts list: late response …” red (ALT appears)
 *   B  sammlung.js after galleryParams(1, holen) `if (gen !== _galGen && false)`
 *      → “gallery: late response …” red (ALT replaces NEU)
 *   C  loadGalleryMore without generation check → “gallery: late next page …” red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter } = require('./helpers/ui');

/** A response that only arrives on call. */
function withheld() {
  let los;
  const antwort = new Promise(r => {
    los = r;
  });
  return { antwort, los: (/** @type {any} */ d) => los(d) };
}

const set = (nr, name) => ({ set_number: nr, name, quantity: 1 });
const teil = (nr, name) => ({ part_number: nr, part_name: name, color_id: 5, color_name: 'Red', total_quantity: 1 });

test('gallery: a late response of an old search is discarded', async () => {
  const alt = withheld();
  const { w, d, warte, aufrufe } = await openUi({
    '/v1/sets': url =>
      new URL(url, 'http://x').searchParams.get('search') === 'new'
        ? { success: true, sets: [set('10300-1', 'NEU-Set')], count: 1, total: 1 }
        : alt.antwort,
  });
  try {
    const gs = d.getElementById('gs');
    gs.value = 'new';
    gs.dispatchEvent(new w.Event('input'));
    assert.ok(await warte(() => /NEU-Set/.test(d.getElementById('gallery').textContent)));
    alt.los({ success: true, sets: [set('10294-1', 'ALT-Set')], count: 1, total: 1 });
    await warte(() => /ALT-Set/.test(d.getElementById('gallery').textContent), 300);
    assert.ok(aufrufe.filter(a => a.url.includes('/v1/sets?')).length >= 2, 'beide Anfragen liefen');
    assert.match(d.getElementById('gallery').textContent, /NEU-Set/);
    assert.doesNotMatch(d.getElementById('gallery').textContent, /ALT-Set/);
  } finally {
    w.close();
  }
});

test('gallery: a late follow-up page of an old search is not appended', async () => {
  // A full first page (60) with a larger total triggers loading more.
  const erste = Array.from({ length: 60 }, (_, i) => set(`${1000 + i}-1`, `Set ${i}`));
  const sequence = withheld();
  const { w, d, warte, aufrufe } = await openUi({
    '/v1/sets': url => {
      const q = new URL(url, 'http://x').searchParams;
      if (q.get('search') === 'new') return { success: true, sets: [set('10300-1', 'NEU-Set')], count: 1, total: 1 };
      return q.get('page') === '2' ? sequence.antwort : { success: true, sets: erste, count: 60, total: 200 };
    },
  });
  try {
    assert.ok(await warte(() => aufrufe.some(a => /\/v1\/sets\?.*page=2/.test(a.url))));
    const gs = d.getElementById('gs');
    gs.value = 'new';
    gs.dispatchEvent(new w.Event('input'));
    assert.ok(await warte(() => /NEU-Set/.test(d.getElementById('gallery').textContent)));
    sequence.los({ success: true, sets: [set('20000-1', 'ALT-Folge')], count: 1, total: 200 });
    await warte(() => /ALT-Folge/.test(d.getElementById('gallery').textContent), 300);
    assert.doesNotMatch(d.getElementById('gallery').textContent, /ALT-Folge/);
  } finally {
    w.close();
  }
});

test('parts list: a late response of an old filter is discarded', async () => {
  const alt = withheld();
  const { w, d, warte } = await openUi({
    '/v1/parts': url =>
      new URL(url, 'http://x').searchParams.get('spare') === '0'
        ? { success: true, parts: [teil('3001', 'NEU-Teil')], total: 1, page: 1, page_size: 100 }
        : alt.antwort,
  });
  try {
    await reiter(w, 'parts');
    const spare = d.getElementById('parts-spare');
    spare.value = '0';
    spare.dispatchEvent(new w.Event('change'));
    assert.ok(await warte(() => /NEU-Teil/.test(d.getElementById('parts-main').textContent)));
    alt.los({ success: true, parts: [teil('3002', 'ALT-Teil')], total: 1, page: 1, page_size: 100 });
    await warte(() => /ALT-Teil/.test(d.getElementById('parts-main').textContent), 300);
    assert.match(d.getElementById('parts-main').textContent, /NEU-Teil/);
    assert.doesNotMatch(d.getElementById('parts-main').textContent, /ALT-Teil/);
  } finally {
    w.close();
  }
});
