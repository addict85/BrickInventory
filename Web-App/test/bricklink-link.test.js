/**
 * BrickLink-Link-Auflösung für Katalog-Sets (src/katalog/bricklinkLink.ts).
 *
 * Gegenproben (08.11.2026 gemessen, am Bündel in jsdom):
 *   A  in openCatModal wieder `blBtn.style.display = bl ? '' : 'none'` → rot:
 *      „der Kauf-Knopf nimmt die Adresse des Servers …“ (Fall ohne Auflösung)
 *   B  `blBtn.href` wieder aus der Setnummer gebaut
 *      (`…catalogitem.page?S=${s.set_number}`) → rot: dieselbe Prüfung
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { withVariant, bareNumber, buildUrl, searchUrl } = _req('src/katalog/bricklinkLink.js');

test('withVariant ergänzt den Rebrickable-Suffix', () => {
  assert.equal(withVariant('75192'), '75192-1');
  assert.equal(withVariant('75192-1'), '75192-1');
  assert.equal(withVariant('10179-2'), '10179-2');
  assert.equal(withVariant('  75192  '), '75192-1');
});

test('bareNumber entfernt ihn wieder — BrickLink führt Gear/Book ohne Suffix', () => {
  assert.equal(bareNumber('5005358-1'), '5005358');
  assert.equal(bareNumber('5005358'), '5005358');
  assert.equal(bareNumber('10179-2'), '10179');
});

test('buildUrl verwendet je Item-Typ den richtigen Parameter', () => {
  const set = buildUrl('SET', '75192-1');
  assert.match(set, /\?S=75192-1/);
  assert.match(set, /#T=S/);

  const gear = buildUrl('GEAR', '5005358');
  assert.match(gear, /\?G=5005358/);
  assert.match(gear, /#T=G/, 'Der For-Sale-Tab muss zum Item-Typ passen, sonst öffnet BrickLink den falschen Reiter');

  const book = buildUrl('BOOK', 'b12ab');
  assert.match(book, /\?B=b12ab/);
  assert.match(book, /#T=B/);
});

test('buildUrl kennt auch MINIFIG', () => {
  const m = buildUrl('MINIFIG', 'col325');
  assert.match(m, /\?M=col325/);
  assert.match(m, /#T=M/);
});

test('buildUrl liefert null für NONE — der Aufrufer weicht auf die Suche aus', () => {
  assert.equal(buildUrl('NONE', 'x-1'), null);
});

test('searchUrl greift, wo kein Deep-Link konstruierbar ist', () => {
  // Sammelminifiguren: Rebrickable führt sie als Set (71021-1), BrickLink als
  // MINIFIG mit anderer Nummer (col325). Die Zuordnung existiert in keiner der
  // beiden Datenquellen — ein Deep-Link ist grundsätzlich nicht herleitbar.
  const u = searchUrl('71021-1');
  assert.match(u, /search\.page\?q=71021/);
  assert.ok(!u.includes('-1'), 'Der Variantensuffix engt die Suche unnötig ein');
});

test('buildUrl kodiert Sonderzeichen in der Nummer', () => {
  const url = buildUrl('SET', '10 30-1');
  assert.ok(!/\?S=10 30/.test(url), 'Leerzeichen muss kodiert werden');
  assert.match(url, /\?S=10%2030-1/);
});

test('Set-Links behalten den Suffix, Gear-Links nicht', () => {
  // Das ist der eigentliche Fehler, der behoben wurde: dieselbe
  // Rebrickable-Nummer ergibt je nach BrickLink-Typ zwei verschiedene URLs.
  assert.match(buildUrl('SET', withVariant('5005358')), /\?S=5005358-1/);
  assert.match(buildUrl('GEAR', bareNumber('5005358-1')), /\?G=5005358(?!-)/);
});

test('der Kauf-Knopf nimmt die Adresse des Servers und wird nie ausgeblendet', async () => {
  const SUCHE = 'https://www.bricklink.com/v2/search.page?q=col001';
  const GEAR = 'https://www.bricklink.com/v2/catalog/catalogitem.page?G=5005358';
  const set = (nr, bricklink) => ({ set_number: nr, name: `Artikel ${nr}`, year: 2020, num_parts: 1, bricklink });
  const { w, d } = await oeffneOberflaeche({
    '/v1/catalog/sets': { success: true, total: 3, sets: [set('col001-1'), set('5005358-1'), set('99999-1')] },
    '/v1/catalog/sets/col001-1': {
      success: true,
      set: set('col001-1', { url: SUCHE, exact: false, type: 'MINIFIG', number: 'col001' }),
    },
    '/v1/catalog/sets/5005358-1': {
      success: true,
      set: set('5005358-1', { url: GEAR, exact: true, type: 'GEAR', number: '5005358' }),
    },
    '/v1/catalog/sets/99999-1': { success: true, set: set('99999-1', null) },
  });
  try {
    await reiter(w, 'catalog');
    const knopf = () => d.getElementById('cat-m-bricklink');
    for (const [nr, href, text] of [
      ['col001-1', SUCHE, 'Auf BrickLink suchen'],
      ['5005358-1', GEAR, 'Auf BrickLink kaufen'],
      // Ohne Auflösung die Suche nach der Nummer — nicht ein ausgeblendeter Knopf.
      ['99999-1', 'https://www.bricklink.com/v2/search.page?q=99999-1', 'Auf BrickLink kaufen'],
    ]) {
      assert.ok(await warte(() => d.querySelector(`[data-click="openCatModal"][data-arg="${nr}"]`)), `Kachel ${nr}`);
      d.querySelector(`[data-click="openCatModal"][data-arg="${nr}"]`).click();
      assert.ok(await warte(() => d.getElementById('cat-m-sub').textContent === nr), `Dialog ${nr}`);
      assert.deepEqual(
        [knopf().style.display, knopf().getAttribute('href'), knopf().textContent.trim()],
        ['', href, text],
        nr,
      );
    }
  } finally {
    w.close();
  }
});
