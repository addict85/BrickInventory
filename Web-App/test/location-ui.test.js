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
const schreibt = (o, pfad) => o.aufrufe.filter(a => a.method === 'PUT' && a.url.endsWith(pfad));
const choose = (o, id, wert) => {
  const s = o.d.getElementById(id);
  s.value = wert;
  assert.equal(s.value, wert, `${id} bietet „${wert}“ nicht an`);
  s.dispatchEvent(new o.w.Event('change', { bubbles: true }));
};

test("web app: in the set detail choose from the owner's stock or type a new one", async () => {
  const o = await openUi({
    [`/v1/sets/${SN}`]: {
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
    '/v1/storage/locations': u => ({
      success: true,
      orte: /owner=7/.test(u)
        ? [
            { id: 1, name: 'Keller' },
            { id: 2, name: 'Regal A' },
          ]
        : [],
    }),
    [`/v1/sets/${SN}/storage`]: { success: true },
  });
  try {
    klick(o, { click: 'openModal', arg: SN });
    assert.ok(
      await warte(() => o.d.querySelector('#m-storage-sel option[value="Regal A"]'), 4000),
      'der Vorrat des Besitzers fehlt in der Auswahl',
    );
    assert.ok(
      o.aufrufe.some(a => /\/v1\/storage\/locations\?owner=7$/.test(a.url)),
      'nicht nach der Liste des Besitzers gefragt',
    );
    assert.equal(o.d.getElementById('m-storage-sel').value, 'Keller');
    choose(o, 'm-storage-sel', 'Regal A');
    assert.ok(await warte(() => schreibt(o, `/v1/sets/${SN}/storage`).length === 1), 'die Wahl speichert nicht');
    assert.deepEqual(JSON.parse(schreibt(o, `/v1/sets/${SN}/storage`)[0].body), { storage: 'Regal A' });
    const auswahl = o.d.getElementById('m-storage-sel');
    auswahl.selectedIndex = [...auswahl.options].findIndex(x => x.dataset.new === '1');
    assert.ok(auswahl.selectedIndex > 0, 'kein Eintrag „neuer Ort“');
    auswahl.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    assert.equal(o.d.getElementById('m-storage').style.display, '', '„neuer Ort“ öffnet kein Textfeld');
    assert.equal(o.d.getElementById('m-storage').value, '');
  } finally {
    o.w.close();
  }
});

test('web app: the part has the field and saves, the figure does not', async () => {
  const o = await openUi({
    '/v1/parts/3001/5/sets': {
      success: true,
      item: { name: 'Stein', color_name: 'Red', total_quantity: 2, owner_ids: [1], storage: null },
      sets: [],
    },
    '/v1/minifigs/sw0001/sets': { success: true, item: { name: 'Figur', total_quantity: 1 }, sets: [] },
    '/v1/storage/locations': { success: true, orte: [{ id: 3, name: 'Kiste 3' }] },
    '/v1/parts/3001/5/storage': { success: true },
  });
  try {
    klick(o, { click: 'openSetItemDetail', arg: 'part', arg2: '3001', arg3: '5' });
    assert.ok(
      await warte(() => o.d.querySelector('#setitem-storage-sel option[value="Kiste 3"]')),
      'Teil: kein Lagerortfeld',
    );
    choose(o, 'setitem-storage-sel', 'Kiste 3');
    assert.ok(
      await warte(() => schreibt(o, '/v1/parts/3001/5/storage').length === 1),
      'Teil: die Wahl speichert nicht',
    );
    o.d.getElementById('setitem-modal').classList.remove('open');
    klick(o, { click: 'openSetItemDetail', arg: 'fig', arg2: 'sw0001', arg3: '0' });
    assert.ok(await warte(() => o.d.getElementById('setitem-tit').textContent === 'Figur'));
    await o.ruhig();
    assert.equal(o.d.getElementById('setitem-storage'), null, 'Figur: das Feld steht auch bei Figuren');
  } finally {
    o.w.close();
  }
});

test('web app: the filter stands next to the account filter and goes to the server', async () => {
  const o = await openUi({
    '/v1/storage': { success: true, orte: [{ ort: 'Regal A', sets: 1, teile: 0, figuren: 0 }] },
  });
  try {
    await o.ruhig();
    for (const view of ['gallery', 'parts'])
      assert.equal(
        o.d.getElementById(`storage-${view}`).parentElement,
        o.d.getElementById(`scope-${view}`).parentElement,
        `${view}: die beiden Filter stehen nicht beieinander`,
      );
    assert.ok(
      await warte(() => o.d.querySelector('#storage-gallery option[value="Regal A"]')),
      'der Filter kennt den Ort nicht',
    );
    choose(o, 'storage-gallery', 'Regal A');
    assert.ok(
      await warte(() => o.aufrufe.some(a => /\/v1\/sets\?.*storage=Regal(\+|%20)A/.test(a.url))),
      'der Filter geht nicht an den Server',
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
    [`/v1/sets/${SN}`]: {
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
      'Das Eingabefeld der Webapp begrenzt anders',
    );
  } finally {
    o.w.close();
  }
});
