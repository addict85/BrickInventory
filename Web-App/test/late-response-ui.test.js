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
const { openUi, switchTab } = require('./helpers/ui');

/** A response that only arrives on call. */
function withheld() {
  let go;
  const response = new Promise(r => {
    go = r;
  });
  return { response, go: (/** @type {any} */ d) => go(d) };
}

const set = (nr, name) => ({ set_number: nr, name, quantity: 1 });
const part = (nr, name) => ({ part_number: nr, part_name: name, color_id: 5, color_name: 'Red', total_quantity: 1 });

test('gallery: a late response of an old search is discarded', async () => {
  const alt = withheld();
  const { w, d, waitFor, calls } = await openUi({
    '/v2/sets': url =>
      new URL(url, 'http://x').searchParams.get('search') === 'new'
        ? { success: true, sets: [set('10300-1', 'NEU-Set')], count: 1, total: 1 }
        : alt.response,
  });
  try {
    const gs = d.getElementById('gs');
    gs.value = 'new';
    gs.dispatchEvent(new w.Event('input'));
    assert.ok(await waitFor(() => /NEU-Set/.test(d.getElementById('gallery').textContent)));
    alt.go({ success: true, sets: [set('10294-1', 'ALT-Set')], count: 1, total: 1 });
    await waitFor(() => /ALT-Set/.test(d.getElementById('gallery').textContent), 300);
    assert.ok(calls.filter(a => a.url.includes('/v2/sets?')).length >= 2, 'both requests ran');
    assert.match(d.getElementById('gallery').textContent, /NEU-Set/);
    assert.doesNotMatch(d.getElementById('gallery').textContent, /ALT-Set/);
  } finally {
    w.close();
  }
});

test('gallery: a late follow-up page of an old search is not appended', async () => {
  // A full first page (60) with a larger total triggers loading more.
  const first = Array.from({ length: 60 }, (_, i) => set(`${1000 + i}-1`, `Set ${i}`));
  const sequence = withheld();
  const { w, d, waitFor, calls } = await openUi({
    '/v2/sets': url => {
      const q = new URL(url, 'http://x').searchParams;
      if (q.get('search') === 'new') return { success: true, sets: [set('10300-1', 'NEU-Set')], count: 1, total: 1 };
      return q.get('page') === '2' ? sequence.response : { success: true, sets: first, count: 60, total: 200 };
    },
  });
  try {
    assert.ok(await waitFor(() => calls.some(a => /\/v2\/sets\?.*page=2/.test(a.url))));
    const gs = d.getElementById('gs');
    gs.value = 'new';
    gs.dispatchEvent(new w.Event('input'));
    assert.ok(await waitFor(() => /NEU-Set/.test(d.getElementById('gallery').textContent)));
    sequence.go({ success: true, sets: [set('20000-1', 'ALT-Folge')], count: 1, total: 200 });
    await waitFor(() => /ALT-Folge/.test(d.getElementById('gallery').textContent), 300);
    assert.doesNotMatch(d.getElementById('gallery').textContent, /ALT-Folge/);
  } finally {
    w.close();
  }
});

test('parts list: a late response of an old filter is discarded', async () => {
  const alt = withheld();
  const { w, d, waitFor } = await openUi({
    '/v2/parts': url =>
      new URL(url, 'http://x').searchParams.get('spare') === '0'
        ? { success: true, parts: [part('3001', 'NEU-Teil')], total: 1, page: 1, page_size: 100 }
        : alt.response,
  });
  try {
    await switchTab(w, 'parts');
    const spare = d.getElementById('parts-spare');
    spare.value = '0';
    spare.dispatchEvent(new w.Event('change'));
    assert.ok(await waitFor(() => /NEU-Teil/.test(d.getElementById('parts-main').textContent)));
    alt.go({ success: true, parts: [part('3002', 'ALT-Teil')], total: 1, page: 1, page_size: 100 });
    await waitFor(() => /ALT-Teil/.test(d.getElementById('parts-main').textContent), 300);
    assert.match(d.getElementById('parts-main').textContent, /NEU-Teil/);
    assert.doesNotMatch(d.getElementById('parts-main').textContent, /ALT-Teil/);
  } finally {
    w.close();
  }
});
