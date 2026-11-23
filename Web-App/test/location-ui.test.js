/**
 * Storage location in the web app. It runs in the real bundle (jsdom), the length limit
 * on the server module; the Android suite checks the app. The server itself (endpoints, stock,
 * filter, owner list, write scope) is checked by location-db, location-stock-db,
 * location-id-db, location-detail-and-stock-db and location-on-add-db;
 * the management in the settings by forms-feedback-ui.
 *
 * Counter-checks (measured 10.11.2026, each on its own, bundle rebuilt):
 *   A  the dispatchEvent(change) removed in locationSelected → red: “web app:
 *      in the set detail …” and “web app: the part …” (no PUT)
 *   B  in set-detail.js loadLocationSelection without the owners → red: same place (owner=)
 *   C  in set-teile.js `if (type === 'part')` → `if (true)` → red: “web app: the
 *      part …” (field on the figure)
 *   D  maxlength="60" → "80" in locationBlock → red: “the length limit …”
 *   E  in kontofilter.js addLocationParam without p.set → red: “web app: the filter …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');
const _req = require('./helpers/sources').buildAndRequire();

const SN = '10305-1';

/** Open a detail like a click: data-click with arguments. */
function klick(o, daten) {
  const k = o.d.createElement('button');
  Object.assign(k.dataset, daten);
  o.d.body.append(k);
  k.click();
}
const schreibt = (o, path) => o.aufrufe.filter(a => a.method === 'PUT' && a.url.endsWith(path));
const choose = (o, id, wert) => {
  const s = o.d.getElementById(id);
  s.value = wert;
  assert.equal(s.value, wert, `${id} does not offer „${wert}“`);
  s.dispatchEvent(new o.w.Event('change', { bubbles: true }));
};

test("web app: in the set detail choose from the owner's stock or type a new one", async () => {
  const o = await openUi({
    [`/v2/sets/${SN}`]: {
      success: true,
      set: {
        set_number: SN,
        name: 'Burg',
        quantity: 1,
        conditions: ['N'],
        instructions: [],
        storage: 'Keller',
        owners: [{ id: 7, username: 'ben' }],
      },
    },
    '/v2/storage/locations': u => ({
      success: true,
      locations: /owner=7/.test(u)
        ? [
            { id: 1, name: 'Keller' },
            { id: 2, name: 'Regal A' },
          ]
        : [],
    }),
    [`/v2/sets/${SN}/storage`]: { success: true },
  });
  try {
    klick(o, { click: 'openModal', arg: SN });
    assert.ok(
      await warte(() => o.d.querySelector('#m-storage-sel option[value="Regal A"]'), 4000),
      'the stock of the owner is missing in the selection',
    );
    assert.ok(
      o.aufrufe.some(a => /\/v2\/storage\/locations\?owner=7$/.test(a.url)),
      'not asked for the list of the owner',
    );
    assert.equal(o.d.getElementById('m-storage-sel').value, 'Keller');
    choose(o, 'm-storage-sel', 'Regal A');
    assert.ok(await warte(() => schreibt(o, `/v2/sets/${SN}/storage`).length === 1), 'the choice does not save');
    assert.deepEqual(JSON.parse(schreibt(o, `/v2/sets/${SN}/storage`)[0].body), { storage: 'Regal A' });
    const auswahl = o.d.getElementById('m-storage-sel');
    auswahl.selectedIndex = [...auswahl.options].findIndex(x => x.dataset.new === '1');
    assert.ok(auswahl.selectedIndex > 0, 'no entry „neuer Ort“');
    auswahl.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    assert.equal(o.d.getElementById('m-storage').style.display, '', '„neuer Ort“ opens no text field');
    assert.equal(o.d.getElementById('m-storage').value, '');
  } finally {
    o.w.close();
  }
});

test('web app: the part has the field and saves, the figure does not', async () => {
  const o = await openUi({
    '/v2/parts/3001/5/sets': {
      success: true,
      item: { name: 'Stein', color_name: 'Red', total_quantity: 2, owner_ids: [1], storage: null },
      sets: [],
    },
    '/v2/minifigs/sw0001/sets': { success: true, item: { name: 'Figur', total_quantity: 1 }, sets: [] },
    '/v2/storage/locations': { success: true, locations: [{ id: 3, name: 'Kiste 3' }] },
    '/v2/parts/3001/5/storage': { success: true },
  });
  try {
    klick(o, { click: 'openSetItemDetail', arg: 'part', arg2: '3001', arg3: '5' });
    assert.ok(
      await warte(() => o.d.querySelector('#setitem-storage-sel option[value="Kiste 3"]')),
      'Part: no storage location field',
    );
    choose(o, 'setitem-storage-sel', 'Kiste 3');
    assert.ok(
      await warte(() => schreibt(o, '/v2/parts/3001/5/storage').length === 1),
      'Part: the choice does not save',
    );
    o.d.getElementById('setitem-modal').classList.remove('open');
    klick(o, { click: 'openSetItemDetail', arg: 'fig', arg2: 'sw0001', arg3: '0' });
    assert.ok(await warte(() => o.d.getElementById('setitem-tit').textContent === 'Figur'));
    await o.ruhig();
    assert.equal(o.d.getElementById('setitem-storage'), null, 'Minifig: the field is there for minifigs too');
  } finally {
    o.w.close();
  }
});

test('web app: the filter stands next to the account filter and goes to the server', async () => {
  const o = await openUi({
    '/v2/storage': { success: true, locations: [{ location: 'Regal A', sets: 1, parts: 0, minifigs: 0 }] },
  });
  try {
    await o.ruhig();
    for (const view of ['gallery', 'parts'])
      assert.equal(
        o.d.getElementById(`storage-${view}`).parentElement,
        o.d.getElementById(`scope-${view}`).parentElement,
        `${view}: the two filters are not next to each other`,
      );
    assert.ok(
      await warte(() => o.d.querySelector('#storage-gallery option[value="Regal A"]')),
      'the filter does not know the location',
    );
    choose(o, 'storage-gallery', 'Regal A');
    assert.ok(
      await warte(() => o.aufrufe.some(a => /\/v2\/sets\?.*storage=Regal(\+|%20)A/.test(a.url))),
      'the filter does not go to the server',
    );
  } finally {
    o.w.close();
  }
});

test('the length limit is the same in server, error text and web app', async () => {
  const { LOCATION_MAX_CHARS: max, normalizeLocation } = {
    ..._req('src/inventory/storageLocation.js'),
    ...require('./helpers/sources').testArea('inventory').locationService,
  };
  assert.ok(max > 0);
  assert.equal(normalizeLocation('x'.repeat(max)), 'x'.repeat(max));
  assert.throws(
    () => normalizeLocation('x'.repeat(max + 1)),
    e => e instanceof Error && e.message.includes(`höchstens ${max} Zeichen`),
  );
  const o = await openUi({
    [`/v2/sets/${SN}`]: {
      success: true,
      set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['N'], instructions: [] },
    },
  });
  try {
    klick(o, { click: 'openModal', arg: SN });
    assert.ok(await warte(() => o.d.getElementById('m-storage'), 4000));
    assert.equal(
      Number(o.d.getElementById('m-storage').getAttribute('maxlength')),
      max,
      'The input field of the web app limits differently',
    );
  } finally {
    o.w.close();
  }
});
