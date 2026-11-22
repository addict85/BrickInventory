/**
 * Build list in the real bundle (jsdom): “add” computes the list immediately, “re-
 * compute” locked with a visible reason; “reset” not red; labeled.
 * Export and options only with parts; the empty result names the reason, a
 * number the catalog does not know is shown as such and does not count as a set.
 *
 * Counter-checks (measured 04.11.2026, each alone):
 *   A  plExportStand() with box.hidden = _plParts === null (the old state) →
 *      red: “empty result” (export visible at 0 parts)
 *   D  in plAddSet setting eintrag.unbekannt removed → red:
 *      “unknown number” (chip without hint, “from 2 sets”)
 *   B  plRenderTable() back with “Keine Teile gefunden” → red: “empty
 *      result” (no reason named)
 *   C  reset back to class="btn bd" → red: “layout”
 *   E  (05.11.2026, UI review 17 M14) color group again without colorName() →
 *      red: “color groups German, summary names kinds” (“Red”)
 *   F  (12.11.2026) plSchritt() not called in plRenderSets (dropped today) → red: “a
 *      main button …”; in plGenerate the typed number not taken over →
 *      red: same place (error at the field instead of list)
 *   H  (14.11.2026, UX review 24 N11) in plRenderSets `btn-pl-gen` not
 *      hidden → red: “add computes immediately …” (visible without content);
 *      empty state without textKey → red: same place (does not say what to do)
 *   G  (12.11.2026, UX review 19 M6) in plAddSet `await plGenerate()`
 *      removed → red: “add computes immediately …” and every check via
 *      erstelle() (no list without a second step); in plRemoveSet the
 *      recomputation removed → red: “remove recomputes”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const TEIL = {
  part_number: '3001',
  part_name: 'Brick 2 x 4',
  color_id: 4,
  color_name: 'Red',
  color_hex: 'C91A09',
  total_quantity: 6,
};

async function create(teile, nummern = '10294') {
  const o = await openUi({
    '/v1/sets/10294-1/parts-list': { success: true, parts: teile },
    '/v1/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v1/sets/info/10294-1': { success: true, name: 'Titanic', im_katalog: true },
    '/v1/sets/info/99999-1': { success: true, name: '99999-1', im_katalog: false },
    '/v1/sets/99999-1/parts-list': { success: true, parts: [] },
    '/v1/sets/99999-1/minifigs-list': { success: true, figs: [] },
    '/v1/parts/bl-color-map': { success: true, map: { 4: 5 } },
  });
  await reiter(o.w, 'partslist');
  o.d.getElementById('pl-setnr').value = nummern;
  o.d.querySelector('[data-click="plAddSet"]').click();
  // Close the window without a list: kept open, jsdom would keep the test process alive.
  if (!(await warte(() => / aus \d+ Set/.test(o.d.getElementById('pl-status').textContent), 3000))) {
    o.w.close();
    assert.fail('Liste erstellt');
  }
  return o;
}

test('setup: labels, reset not red', async () => {
  const { w, d } = await openUi();
  try {
    assert.equal(text(d.querySelector('label[for="pl-setnr"]')), 'Setnummern (mehrere mit Komma trennen)');
    assert.equal(text(d.querySelector('label[for="pl-bl-condition"]')), 'Zustand für BrickLink');
    assert.equal(text(d.getElementById('btn-pl-gen')), 'Neu berechnen');
    assert.equal(d.getElementById('btn-pl-reset').classList.contains('bd'), false, 'Zurücksetzen ist rot');
    assert.equal(d.getElementById('pl-export').hidden, true, 'Exportieren vor dem ersten Ergebnis');
  } finally {
    w.close();
  }
});

test('adding computes immediately, without a second step; "recompute" only with a set', async () => {
  const o = await openUi({
    '/v1/sets/info/10294-1': { success: true, name: 'Titanic', im_katalog: true },
    '/v1/sets/10294-1/parts-list': { success: true, parts: [TEIL] },
    '/v1/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v1/parts/bl-color-map': { success: true, map: { 4: 5 } },
  });
  const { w, d } = o;
  try {
    await reiter(w, 'partslist');
    const haupt = () => [...d.querySelectorAll('#tab-partslist .btn.bp')].map(text);
    const gen = d.getElementById('btn-pl-gen');
    assert.deepEqual(haupt(), ['Hinzufügen'], 'ohne Sets');
    assert.equal(gen.hidden, true, '„Neu berechnen“ ohne Inhalt sichtbar');
    assert.match(
      text(d.getElementById('pl-sets')),
      /noch leer.*entsteht sofort/,
      'der Leerzustand sagt nicht, was zu tun ist',
    );
    assert.equal(
      d.querySelectorAll('#tab-partslist [data-i18n="pl.erst_set"]').length,
      0,
      'Leerzustand doppelt gesagt',
    );
    assert.equal(d.querySelector('#pl-sets button'), null, 'der Leerzustand hat einen eigenen Knopf');

    d.getElementById('pl-setnr').value = '10294';
    d.getElementById('btn-pl-add').click();
    assert.ok(await warte(() => / aus 1 Set/.test(d.getElementById('pl-status').textContent), 3000), 'keine Liste');
    assert.ok(d.querySelector('#pl-result .pl-have-input'), 'die Tabelle fehlt');
    assert.deepEqual(haupt(), ['Hinzufügen'], 'mit Set');
    assert.equal(gen.hidden, false, '„Neu berechnen“ fehlt mit Set');
  } finally {
    w.close();
  }
});

test('removing recomputes', async () => {
  const { w, d } = await create([TEIL], '10294, 99999-1');
  try {
    d.querySelector('#pl-sets .pl-chip:nth-child(2) [data-click="plRemoveSet"]').click();
    assert.ok(
      await warte(() => text(d.getElementById('pl-status')) === '1 Sorte (6 Teile) aus 1 Set', 3000),
      text(d.getElementById('pl-status')),
    );
    assert.ok(d.querySelector('#pl-result .pl-have-input'), 'die Tabelle fehlt');
  } finally {
    w.close();
  }
});

test('empty result: reason, no exports', async () => {
  const { w, d } = await create([]);
  try {
    assert.equal(d.getElementById('pl-optionen').hidden, true, 'Export und Optionen bei 0 Teilen');
    assert.equal(d.getElementById('btn-pl-pdf').disabled, true, 'PDF bei 0 Teilen');
    assert.match(text(d.getElementById('pl-result')), /noch keine Teileliste vor.*Rebrickable/);
    assert.equal(text(d.getElementById('pl-status')), '0 Sorten (0 Teile) aus 1 Set');
  } finally {
    w.close();
  }
});

test('unknown number: named in the chip, not counted', async () => {
  const { w, d } = await create([TEIL], '10294, 99999-1');
  try {
    const chips = [...d.querySelectorAll('#pl-sets .pl-chip')].map(c => ({
      text: text(c),
      unbekannt: c.classList.contains('unbekannt'),
    }));
    assert.deepEqual(chips, [
      { text: '10294-1 — Titanic', unbekannt: false },
      { text: '99999-1 — nicht im Katalog', unbekannt: true },
    ]);
    assert.equal(
      text(d.getElementById('pl-status')),
      '1 Sorte (6 Teile) aus 1 Set · 1 Nummer nicht im Katalog: 99999-1',
    );
  } finally {
    w.close();
  }
});

test('result with parts: exports enabled, input fields labeled', async () => {
  const { w, d } = await create([TEIL]);
  try {
    assert.equal(d.getElementById('pl-optionen').hidden, false);
    assert.equal(d.getElementById('btn-pl-pdf').disabled, false);
    assert.equal(text(d.getElementById('pl-status')), '1 Sorte (6 Teile) aus 1 Set');
    assert.equal(d.querySelector('.pl-have-input').getAttribute('aria-label'), 'Vorhanden: 3001 Red');
  } finally {
    w.close();
  }
});

test('color groups in German, summary names the kinds', async () => {
  const { w, d } = await create([TEIL, { ...TEIL, part_number: '3003', part_name: 'Brick 2 x 2', total_quantity: 10 }]);
  try {
    assert.match(text(d.getElementById('pl-result')), /^Rot \(2 Sorten\)/, 'Farbgruppe in der Sprache der Oberfläche');
    assert.doesNotMatch(text(d.getElementById('pl-result')), /\bRed\b/);
    assert.equal(text(d.getElementById('pl-status')), '2 Sorten (16 Teile) aus 1 Set');
  } finally {
    w.close();
  }
});
