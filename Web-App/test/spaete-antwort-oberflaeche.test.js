/**
 * Späte Antworten einer verworfenen Filterkombination landen nicht in der
 * Liste: Galerie (02-gallery.js) und Teileliste (03-parts.js) zählen eine
 * Generation hoch und verwerfen, was zu einer älteren gehört. In jsdom mit
 * zurückgehaltener erster Antwort, die erst nach der zweiten eintrifft.
 *
 * Gegenproben (05.11.2026, je einzeln, Mutationen des Prüfberichts):
 *   A  03-parts.js `if (gen !== _partsGen) { _partsLoading = false; return; }`
 *      ohne `return` → „Teileliste: späte Antwort …“ rot (ALT erscheint)
 *   B  02-gallery.js nach galleryParams(1, holen) `if (gen !== _galGen && false)`
 *      → „Galerie: späte Antwort …“ rot (ALT ersetzt NEU)
 *   C  loadGalleryMore ohne Generationsprüfung → „Galerie: späte Folgeseite …“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter } = require('./helpers/oberflaeche');

/** Eine Antwort, die erst auf Zuruf eintrifft. */
function zurueckgehalten() {
  let los;
  const antwort = new Promise(r => { los = r; });
  return { antwort, los: (/** @type {any} */ d) => los(d) };
}

const set = (nr, name) => ({ set_number: nr, name, quantity: 1 });
const teil = (nr, name) => ({ part_number: nr, part_name: name, color_id: 5, color_name: 'Red', total_quantity: 1 });

test('Galerie: späte Antwort einer alten Suche wird verworfen', async () => {
  const alt = zurueckgehalten();
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/sets': (url) => new URL(url, 'http://x').searchParams.get('search') === 'neu'
      ? { success: true, sets: [set('10300-1', 'NEU-Set')], count: 1, total: 1 }
      : alt.antwort,
  });
  try {
    const gs = d.getElementById('gs');
    gs.value = 'neu';
    gs.dispatchEvent(new w.Event('input'));
    assert.ok(await warte(() => /NEU-Set/.test(d.getElementById('gallery').textContent)));
    alt.los({ success: true, sets: [set('10294-1', 'ALT-Set')], count: 1, total: 1 });
    await warte(() => /ALT-Set/.test(d.getElementById('gallery').textContent), 300);
    assert.ok(aufrufe.filter(a => a.url.includes('/v1/sets?')).length >= 2, 'beide Anfragen liefen');
    assert.match(d.getElementById('gallery').textContent, /NEU-Set/);
    assert.doesNotMatch(d.getElementById('gallery').textContent, /ALT-Set/);
  } finally { w.close(); }
});

test('Galerie: späte Folgeseite einer alten Suche wird nicht angehängt', async () => {
  // Eine volle erste Seite (60) mit grösserem total löst das Nachladen aus.
  const erste = Array.from({ length: 60 }, (_, i) => set(`${1000 + i}-1`, `Set ${i}`));
  const folge = zurueckgehalten();
  const { w, d, warte, aufrufe } = await oeffneOberflaeche({
    '/v1/sets': (url) => {
      const q = new URL(url, 'http://x').searchParams;
      if (q.get('search') === 'neu') return { success: true, sets: [set('10300-1', 'NEU-Set')], count: 1, total: 1 };
      return q.get('page') === '2' ? folge.antwort : { success: true, sets: erste, count: 60, total: 200 };
    },
  });
  try {
    assert.ok(await warte(() => aufrufe.some(a => /\/v1\/sets\?.*page=2/.test(a.url))));
    const gs = d.getElementById('gs');
    gs.value = 'neu';
    gs.dispatchEvent(new w.Event('input'));
    assert.ok(await warte(() => /NEU-Set/.test(d.getElementById('gallery').textContent)));
    folge.los({ success: true, sets: [set('20000-1', 'ALT-Folge')], count: 1, total: 200 });
    await warte(() => /ALT-Folge/.test(d.getElementById('gallery').textContent), 300);
    assert.doesNotMatch(d.getElementById('gallery').textContent, /ALT-Folge/);
  } finally { w.close(); }
});

test('Teileliste: späte Antwort eines alten Filters wird verworfen', async () => {
  const alt = zurueckgehalten();
  const { w, d, warte } = await oeffneOberflaeche({
    '/v1/parts': (url) => new URL(url, 'http://x').searchParams.get('spare') === '0'
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
  } finally { w.close(); }
});
