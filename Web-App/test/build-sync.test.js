/**
 * “Can I build this?" in the web app, in jsdom (real bundle). The app calls the same
 * endpoint (shared/app-schnittstelle.json, test/app-interface.test.js).
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
    '/v1/sets/10294-1/parts-list': {
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
    '/v1/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v1/sets/info/10294-1': { success: true, name: 'Titanic', im_katalog: true },
    '/v1/parts/bl-color-map': { success: true, map: { 4: 5 } },
    '/v1/parts/owned': (url, opt) => {
      anfragen.push({ url, teile: JSON.parse(opt.body).teile });
      return { success: true, bestand: { '3001|4': { gesamt: 5, lose: 2 } } };
    },
  });
  try {
    await reiter(w, 'partslist');
    d.getElementById('pl-setnr').value = '10294';
    d.querySelector('[data-click="plAddSet"]').click();
    await warte(() => d.querySelector('#pl-sets .pl-chip-name')?.textContent.trim(), 3000);
    d.getElementById('btn-pl-gen').click();
    assert.ok(await warte(() => d.querySelector('.pl-have-input'), 3000), 'keine Bauliste');
    const feld = () => d.querySelector('.pl-have-input').value;

    d.getElementById('btn-pl-bestand').click();
    assert.ok(await warte(() => anfragen.length === 1 && feld() === '5'), `alles: ${feld()}`);
    // With the BrickLink number the server would find nothing — and “not found” looks like “don't have it”.
    assert.deepEqual(anfragen[0].teile, [{ part_number: '3001', color_id: 4 }]);
    assert.match(anfragen[0].url, /\/api\/v1\/parts\/owned\?accounts=own$/, 'ohne Haken zählt der Haushalt mit');
    assert.doesNotMatch(d.getElementById('pl-status').textContent, /\bpl\./, 'Statustext ohne Übersetzung');

    const lose = d.getElementById('pl-bestand-lose');
    lose.checked = true;
    lose.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => anfragen.length === 2 && feld() === '2'), `nur lose: ${feld()}`);

    const subs = d.getElementById('pl-bestand-subs');
    subs.checked = true;
    subs.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => anfragen.length === 3), 'mit Unterkonten nicht neu gefragt');
    assert.match(anfragen[2].url, /\/api\/v1\/parts\/owned$/, 'mit Unterkonten trotzdem nur das eigene Konto');
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
      assert.ok(s.includes(`'${k}'`), `${datei}: ${k} fehlt`);
    }
  }
});
