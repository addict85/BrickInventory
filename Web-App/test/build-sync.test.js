/**
 * “Can I build this?" in the web app, in jsdom (real bundle). The app calls the same
 * endpoint (shared/app-interface.json, test/app-interface.test.js).
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted, bundle rebuilt):
 *   A  plFuelleBestand() sends the BrickLink number 3001b for 3001 → red: “web app: …”
 *   B  `nurLose ? eintrag.lose : eintrag.gesamt` swapped → red: “web app: …”
 *   C  `?accounts=own` always appended → red: “web app: …” (with sub-accounts)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');
// STRIP comments, already here while reading.
const lies = p => ohneKommentare(fs.readFileSync(p, 'utf8'));
const web = rel => lies(path.join(WEB, rel));

test('web app: asks the endpoint in Rebrickable notation, distinguishes loose and own scope', async () => {
  const { openUi, reiter, warte } = require('./helpers/ui');
  const anfragen = [];
  const { w, d } = await openUi({
    '/v2/sets/10294-1/parts-list': {
      success: true,
      parts: [
        {
          part_number: '3001',
          bl_part_number: '3001b',
          part_name: 'Brick 2 x 4',
          color_id: 4,
          color_name: 'Red',
          color_hex: 'C91A09',
          quantity: 6,
        },
      ],
    },
    '/v2/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v2/sets/info/10294-1': { success: true, name: 'Titanic', in_catalog: true },
    '/v2/parts/bl-color-map': { success: true, map: { 4: 5 } },
    '/v2/parts/owned': (url, opt) => {
      anfragen.push({ url, parts: JSON.parse(opt.body).parts });
      return { success: true, holding: { '3001|4': { total: 5, loose: 2 } } };
    },
  });
  try {
    await reiter(w, 'partslist');
    d.getElementById('pl-setnr').value = '10294';
    d.querySelector('[data-click="plAddSet"]').click();
    await warte(() => d.querySelector('#pl-sets .pl-chip-name')?.textContent.trim(), 3000);
    d.getElementById('btn-pl-gen').click();
    assert.ok(await warte(() => d.querySelector('.pl-have-input'), 3000), 'no build list');
    const field = () => d.querySelector('.pl-have-input').value;

    d.getElementById('btn-pl-stock').click();
    assert.ok(await warte(() => anfragen.length === 1 && field() === '5'), `alles: ${field()}`);
    // With the BrickLink number the server would find nothing — and “not found” looks like “don't have it”.
    assert.deepEqual(anfragen[0].parts, [{ part_number: '3001', color_id: 4 }]);
    assert.match(
      anfragen[0].url,
      /\/api\/v2\/parts\/owned\?accounts=own$/,
      'without the checkmark the household counts too',
    );
    assert.doesNotMatch(d.getElementById('pl-status').textContent, /\bpl\./, 'Status text without translation');

    const loose = d.getElementById('pl-stock-lose');
    loose.checked = true;
    loose.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => anfragen.length === 2 && field() === '2'), `nur lose: ${field()}`);

    const subs = d.getElementById('pl-stock-subs');
    subs.checked = true;
    subs.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => anfragen.length === 3), 'not asked again with sub-accounts');
    assert.match(anfragen[2].url, /\/api\/v2\/parts\/owned$/, 'with sub-accounts still only the own account');
  } finally {
    w.close();
  }
});

test('both languages are maintained', () => {
  // A missing key does not stand out in this web app: t() returns the
  // key name, and “pl.only_loose" looks at first glance like
  // a text.
  for (const datei of ['public/locales/de.js', 'public/locales/en.js']) {
    const s = web(datei);
    for (const k of [
      'pl.fill_owned',
      'pl.only_loose',
      'pl.include_subs',
      'pl.owned_complete',
      'pl.owned_missing',
      'pl.owned_none',
      'pl.owned_filled',
    ]) {
      assert.ok(s.includes(`'${k}'`), `${datei}: ${k} is missing`);
    }
  }
});
