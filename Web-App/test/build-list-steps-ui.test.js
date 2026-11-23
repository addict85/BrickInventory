/**
 * Build list in the real bundle (jsdom): “add” computes the list immediately, “re-
 * compute” locked with a visible reason; “reset” not red; labeled.
 * Export and options only with parts; the empty result names the reason, a
 * number the catalog does not know is shown as such and does not count as a set.
 *
 * Counter-checks (measured 04.11.2026, each alone):
 *   A  plExportStatus() with box.hidden = _plParts === null (the old state) →
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
const { openUi, switchTab, waitFor } = require('./helpers/ui');

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const PART = {
  part_number: '3001',
  part_name: 'Brick 2 x 4',
  color_id: 4,
  color_name: 'Red',
  color_hex: 'C91A09',
  total_quantity: 6,
};

async function create(parts, numbers = '10294') {
  const o = await openUi({
    '/v2/sets/10294-1/parts-list': { success: true, parts: parts },
    '/v2/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v2/sets/info/10294-1': { success: true, name: 'Titanic', in_catalog: true },
    '/v2/sets/info/99999-1': { success: true, name: '99999-1', in_catalog: false },
    '/v2/sets/99999-1/parts-list': { success: true, parts: [] },
    '/v2/sets/99999-1/minifigs-list': { success: true, figs: [] },
    '/v2/parts/bl-color-map': { success: true, map: { 4: 5 } },
  });
  await switchTab(o.w, 'partslist');
  o.d.getElementById('pl-setnr').value = numbers;
  o.d.querySelector('[data-click="plAddSet"]').click();
  // Close the window without a list: kept open, jsdom would keep the test process alive.
  if (!(await waitFor(() => / aus \d+ Set/.test(o.d.getElementById('pl-status').textContent), 3000))) {
    o.w.close();
    assert.fail('List created');
  }
  return o;
}

test('setup: labels, reset not red', async () => {
  const { w, d } = await openUi();
  try {
    assert.equal(text(d.querySelector('label[for="pl-setnr"]')), 'Setnummern (mehrere mit Komma trennen)');
    assert.equal(text(d.querySelector('label[for="pl-bl-condition"]')), 'Zustand für BrickLink');
    assert.equal(text(d.getElementById('btn-pl-gen')), 'Neu berechnen');
    assert.equal(d.getElementById('btn-pl-reset').classList.contains('bd'), false, 'Reset is red');
    assert.equal(d.getElementById('pl-export').hidden, true, 'Export before the first result');
  } finally {
    w.close();
  }
});

test('adding computes immediately, without a second step; "recompute" only with a set', async () => {
  const o = await openUi({
    '/v2/sets/info/10294-1': { success: true, name: 'Titanic', in_catalog: true },
    '/v2/sets/10294-1/parts-list': { success: true, parts: [PART] },
    '/v2/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v2/parts/bl-color-map': { success: true, map: { 4: 5 } },
  });
  const { w, d } = o;
  try {
    await switchTab(w, 'partslist');
    const main = () => [...d.querySelectorAll('#tab-partslist .btn.bp')].map(text);
    const gen = d.getElementById('btn-pl-gen');
    assert.deepEqual(main(), ['Hinzufügen'], 'without sets');
    assert.equal(gen.hidden, true, '„Neu berechnen“ visible without content');
    assert.match(
      text(d.getElementById('pl-sets')),
      /noch leer.*entsteht sofort/,
      'the empty state does not say what to do',
    );
    assert.equal(d.querySelectorAll('#tab-partslist [data-i18n="pl.erst_set"]').length, 0, 'empty state said twice');
    assert.equal(d.querySelector('#pl-sets button'), null, 'the empty state has a button of its own');

    d.getElementById('pl-setnr').value = '10294';
    d.getElementById('btn-pl-add').click();
    assert.ok(await waitFor(() => / aus 1 Set/.test(d.getElementById('pl-status').textContent), 3000), 'no list');
    assert.ok(d.querySelector('#pl-result .pl-have-input'), 'the table is missing');
    assert.deepEqual(main(), ['Hinzufügen'], 'with set');
    assert.equal(gen.hidden, false, '„Neu berechnen“ missing with set');
  } finally {
    w.close();
  }
});

test('removing recomputes', async () => {
  const { w, d } = await create([PART], '10294, 99999-1');
  try {
    d.querySelector('#pl-sets .pl-chip:nth-child(2) [data-click="plRemoveSet"]').click();
    assert.ok(
      await waitFor(() => text(d.getElementById('pl-status')) === '1 Sorte (6 Teile) aus 1 Set', 3000),
      text(d.getElementById('pl-status')),
    );
    assert.ok(d.querySelector('#pl-result .pl-have-input'), 'the table is missing');
  } finally {
    w.close();
  }
});

test('empty result: reason, no exports', async () => {
  const { w, d } = await create([]);
  try {
    assert.equal(d.getElementById('pl-options').hidden, true, 'Export and options at 0 parts');
    assert.equal(d.getElementById('btn-pl-pdf').disabled, true, 'PDF at 0 parts');
    assert.match(text(d.getElementById('pl-result')), /noch keine Teileliste vor.*Rebrickable/);
    assert.equal(text(d.getElementById('pl-status')), '0 Sorten (0 Teile) aus 1 Set');
  } finally {
    w.close();
  }
});

test('unknown number: named in the chip, not counted', async () => {
  const { w, d } = await create([PART], '10294, 99999-1');
  try {
    const chips = [...d.querySelectorAll('#pl-sets .pl-chip')].map(c => ({
      text: text(c),
      unknownOne: c.classList.contains('unknown'),
    }));
    assert.deepEqual(chips, [
      { text: '10294-1 — Titanic', unknownOne: false },
      { text: '99999-1 — nicht im Katalog', unknownOne: true },
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
  const { w, d } = await create([PART]);
  try {
    assert.equal(d.getElementById('pl-options').hidden, false);
    assert.equal(d.getElementById('btn-pl-pdf').disabled, false);
    assert.equal(text(d.getElementById('pl-status')), '1 Sorte (6 Teile) aus 1 Set');
    assert.equal(d.querySelector('.pl-have-input').getAttribute('aria-label'), 'Vorhanden: 3001 Red');
  } finally {
    w.close();
  }
});

test('color groups in German, summary names the kinds', async () => {
  const { w, d } = await create([PART, { ...PART, part_number: '3003', part_name: 'Brick 2 x 2', total_quantity: 10 }]);
  try {
    assert.match(text(d.getElementById('pl-result')), /^Rot \(2 Sorten\)/, 'Color group in the UI language');
    assert.doesNotMatch(text(d.getElementById('pl-result')), /\bRed\b/);
    assert.equal(text(d.getElementById('pl-status')), '2 Sorten (16 Teile) aus 1 Set');
  } finally {
    w.close();
  }
});
