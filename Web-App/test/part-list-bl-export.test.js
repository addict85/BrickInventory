/**
 * The BrickLink export of the parts list — what it leaves out and what it says. On the
 * real bundle in jsdom: create a build list, click „BrickLink XML“, read the
 * delivered file and the messages.
 *
 * Counter-checks (measured 08.11.2026, each on its own, reverted afterwards):
 *   E  the color chain in plRenderTable again to `?? p.color_id ?? ''` →
 *      red: both cases (COLOR 999 in the file, no message)
 *   F  instead of `exportable` again `expanded` given into the XML → red: the same
 *      check (items without COLOR in the file)
 *   G  the success message typed in again as German text → red: “the
 *      messages are translated” (English UI)
 *   H  the export builds the XML again with `<?xml …?>` in front → red: “no
 *      Rebrickable color number …” (file does not begin with <INVENTORY>)
 *   I  the message pl.bl_no_color removed → red: both cases
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

const ROT = {
  part_number: '3001',
  part_name: 'Brick 2 x 4',
  color_id: 4,
  color_name: 'Red',
  color_hex: 'C91A09',
  quantity: 6,
};
// The mapping does not know Rebrickable color 999: a guessed color would order the wrong part.
const UNKNOWN = {
  part_number: '3002',
  part_name: 'Brick 2 x 3',
  color_id: 999,
  color_name: 'Mystery',
  color_hex: null,
  quantity: 2,
};

async function exportIt(language) {
  const o = await openUi(
    {
      '/v2/sets/10294-1/parts-list': { success: true, parts: [ROT, UNKNOWN] },
      '/v2/sets/10294-1/minifigs-list': { success: true, figs: [] },
      '/v2/sets/info/10294-1': { success: true, name: 'Titanic', in_catalog: true },
      '/v2/parts/bl-color-map': { success: true, map: { 4: 5 } },
    },
    { language },
  );
  const dateien = [];
  o.w.URL.createObjectURL = blob => {
    dateien.push(blob);
    return `blob:test/${dateien.length}`;
  };
  o.w.URL.revokeObjectURL = () => {};
  o.w.open = () => ({});
  try {
    return await operate(o, dateien);
  } catch (e) {
    o.w.close();
    throw e;
  }
}

async function operate(o, dateien) {
  await reiter(o.w, 'partslist');
  o.d.getElementById('pl-setnr').value = '10294';
  o.d.querySelector('[data-click="plAddSet"]').click();
  await warte(() => o.d.querySelector('#pl-sets .pl-chip-name')?.textContent.trim(), 3000);
  o.d.getElementById('btn-pl-gen').click();
  assert.ok(await warte(() => o.d.querySelector('.pl-have-input'), 3000), 'Liste erstellt');
  o.d.getElementById('btn-pl-bl').click();
  assert.ok(
    await warte(() => dateien.length === 1 && o.d.querySelectorAll('#toasts .toast').length >= 2, 3000),
    'Kein Export',
  );
  const xml = await dateien[0].text();
  const meldungen = [...o.d.querySelectorAll('#toasts .toast')].map(t => ({ kind: t.className, text: t.textContent }));
  return { ...o, xml, meldungen };
}

test('no Rebrickable color number goes out as a BrickLink color — items without one are named', async () => {
  const { w, xml, meldungen } = await exportIt('de');
  try {
    // Without an XML declaration: BrickLink rejects a file with one (bricklink-wanted-xml.test.js checks the building block).
    assert.ok(xml.startsWith('<INVENTORY>'), xml.slice(0, 60));
    assert.match(xml, /<ITEMID>3001<\/ITEMID>\s*<COLOR>5<\/COLOR>/, 'Die BrickLink-Farbe aus der Zuordnung');
    assert.doesNotMatch(xml, /3002|<COLOR>999<\/COLOR>|<COLOR>4<\/COLOR>/, xml);
    assert.equal((xml.match(/<ITEM>/g) || []).length, 1);
    const error = meldungen.find(m => /error/.test(m.kind));
    assert.match(
      error?.text ?? '',
      /1 Posten ohne bekannte BrickLink-Farbe.*3002 \(Mystery\)/,
      JSON.stringify(meldungen),
    );
  } finally {
    w.close();
  }
});

test('the messages are translated, not typed in', async () => {
  const { w, meldungen } = await exportIt('en');
  try {
    const texte = meldungen.map(m => m.text).join(' | ');
    assert.match(texte, /1 missing part types? exported/);
    assert.match(texte, /1 items? without a known BrickLink colour/);
    assert.doesNotMatch(texte, /fehlende|Posten/);
  } finally {
    w.close();
  }
});
