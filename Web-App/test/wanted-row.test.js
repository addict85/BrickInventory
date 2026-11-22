/**
 * The web app's wishlist row: no takeover button, the market price instead.
 * And the storage location is in the detail of the manual entries. The web app
 * runs in the real bundle (jsdom), the server against the test DB.
 *
 * Counter-checks (measured 10.11.2026, each individually, bundle or dist rebuilt):
 *   A  market price omitted in the row of wanted.js → red: “the web app row …”
 *   B  the trash removed there → red: same place
 *   C  trash of the manual tile removed in parts.js → red: “manual
 *      entries …”
 *   D  storage location row removed in manual-detail.js → red: same place
 *   E  in partsList.ts manualParts `NULL::text AS storage` → red: “the query
 *      of the manual parts …”
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, reiter, warte } = require('./helpers/ui');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsPart } = require('./helpers/inventory');
test.after(() =>
  testData()
    .pool.end()
    .catch(() => {}),
);

test('the web app row shows market price and trash, no takeover button', async () => {
  const o = await openUi({
    '/v2/wanted': {
      success: true,
      item: [
        { set_number: '10305-1', condition: 'N', user_id: 1, name: 'Burg', market_price: 349.99, currency: 'EUR' },
      ],
    },
  });
  try {
    await reiter(o.w, 'wanted');
    assert.ok(await warte(() => o.d.querySelector('#mk-list .mk-row')), 'keine Zeile');
    const z = o.d.querySelector('#mk-list .mk-row');
    assert.match(z.querySelector('.mk-price')?.textContent ?? '', /349[.,]99/, 'kein Marktpreis');
    assert.ok(z.querySelector('.delbtn[data-click="stopDeleteWantedItem"]'), 'kein Papierkorb');
    assert.equal(z.querySelector('[data-click="takeOverWantedItem"]'), null, 'die Zeile übernimmt wieder');
    assert.equal(z.dataset.click, 'openWantedDetail', 'die Zeile öffnet nicht das Detail');
  } finally {
    o.w.close();
  }
});

test('manual entries: trash on the tile, storage location and delete in the detail', async () => {
  const o = await openUi({
    '/v2/parts/manual': {
      success: true,
      parts: [{ part_number: '3001', color_id: 4, quantity: 3, user_id: 1, part_name: 'Stein', storage: 'Kiste 3' }],
      total: 1,
      page: 1,
      page_size: 50,
    },
  });
  try {
    await reiter(o.w, 'parts');
    assert.ok(await warte(() => o.d.querySelector('#manual-parts-list .man-tile')), 'keine manuelle Kachel');
    const kachel = o.d.querySelector('#manual-parts-list .man-tile');
    assert.ok(kachel.querySelector('.delbtn[data-click="deleteManualPartStop"]'), 'kein Papierkorb auf der Kachel');
    kachel.click();
    assert.ok(await warte(() => o.d.getElementById('man-storage')), 'das Detail hat keine Lagerortzeile');
    assert.ok(o.d.getElementById('man-detail-modal').classList.contains('open'));
    for (const id of ['btn-md', 'mk-m-del', 'man-detail-del'])
      assert.ok(o.d.getElementById(id), `der Papierkorb im Detail fehlt (${id})`);
  } finally {
    o.w.close();
  }
});

test('the query of the manual parts delivers the storage location', async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const U = 990900 + (process.pid % 90);
  const weg = async () => {
    await db.run('DELETE FROM parts WHERE user_id=$1', [U]).catch(() => {});
    await db.run('DELETE FROM storage_locations WHERE user_id=$1', [U]).catch(() => {});
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
  };
  await weg();
  t.after(weg);
  await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,$2,'x')", [U, `mz${U}`]);
  const location = (
    await db.get("INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 3') RETURNING id", [U])
  ).id;
  await holdsPart(db, U, `mz-${U}`, { colorId: 4, quantity: 2, storageId: location });
  const parts = await require('./helpers/sources').handlerModule(_req).manualPartsList([U], U);
  assert.deepEqual(
    parts.map(p => [p.part_number, p.storage]),
    [[`mz-${U}`, 'Kiste 3']],
  );
});
