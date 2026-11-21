/**
 * The total row of the entries is computed by the SERVER — once.
 *
 * Counter-check (measured 08.11.2026): acqSummary() does not read totals.quantity
 * (`const menge = 0`) or sumsText() does not compute with totals.amount → red:
 * “no UI computes the sum again”.
 * Counter-check (performed): `amount` in acquisitionTotals() set to 0 instead of null
 * for missing prices → the edge case substep turns red. And an
 * inserted `acqs.reduce(...)` in admin.js → the rule substep.
 * Counter-check of 30.10.2026: `totals` removed from the parts response in
 * routes/api_v1/acquisitions.ts → red: “parts” in the route substep.
 * Since 05.11.2026 `amount` is missing without a known price (money has a type);
 * measured: the route without the omission → red: “minifigs” (amount: null
 * violates the contract, the response has no entries).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { openUi, warte } = require('./helpers/ui');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { acquisitionTotals } = _req('src/inventory/acquisitions.js');

// ── Part 1: the computation ─────────────────────────────────────────────────

test('quantity and amount: weighted by quantity over all rows', () => {
  const t = acquisitionTotals([
    { quantity: 2, purchase_price: '7.41' }, // from Postgres NUMERIC comes as text
    { quantity: 1, purchase_price: 9.48 },
  ]);
  assert.equal(t.quantity, 3);
  assert.equal(t.amount, 24.3); // 2×7.41 + 1×9.48
  assert.equal(t.priced_rows, 2);
});

test('unit_price counts just like purchase_price', () => {
  // Manual parts and minifigures carry the price in unit_price. The
  // fallback rule is therefore HERE and not in one of the clients.
  assert.equal(acquisitionTotals([{ quantity: 3, unit_price: 0.6 }]).amount, 1.8);
});

test('without a price the amount is null — not 0', () => {
  // “Nothing entered" is something other than “bought for zero francs". Only with
  // null can the UI show the dash without guessing itself;
  // with 0 every view would have to make the same interpretation again.
  const t = acquisitionTotals([{ quantity: 2 }, { quantity: 1, purchase_price: null }]);
  assert.equal(t.quantity, 3, 'die Stücke sind da, auch ohne Preis');
  assert.equal(t.amount, null);
  assert.equal(t.priced_rows, 0);
});

test('a row with price 0 is captured and yields 0', () => {
  // Distinction from the case above: 0 is a price, not a missing value —
  // otherwise a gifted set would disappear from the count.
  const t = acquisitionTotals([{ quantity: 1, purchase_price: 0 }]);
  assert.equal(t.amount, 0);
  assert.equal(t.priced_rows, 1);
});

test('mixed: rows with and without price', () => {
  const t = acquisitionTotals([{ quantity: 2, purchase_price: 10 }, { quantity: 5 }]);
  assert.equal(t.quantity, 7, 'die preislose Zeile zählt bei der MENGE mit');
  assert.equal(t.amount, 20, 'beim BETRAG nicht — sie hat keinen');
});

test('the amount is rounded to two places', () => {
  // Otherwise 3 × 11.326666 shows up as 33.980000000000004 on screen.
  const t = acquisitionTotals([{ quantity: 3, purchase_price: 11.326666 }]);
  assert.equal(String(t.amount).split('.')[1]?.length <= 2, true, `war: ${t.amount}`);
});

test('empty list', () => {
  assert.deepEqual(acquisitionTotals([]), { quantity: 0, amount: null, priced_rows: 0 });
  assert.deepEqual(acquisitionTotals(null), { quantity: 0, amount: null, priced_rows: 0 });
});

// ── Part 2: the rule ────────────────────────────────────────────────────────

test('all three acquisition routes deliver the sum', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    NAME = `summen-${P}`,
    SN = `${P}7-1`,
    PN = `su${P}`,
    FN = `fig-su${P}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  // The account currency is that of the purchases: so the sum stays verifiable without conversion.
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')", [uid]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  await db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                VALUES ($1,$2,2,7.41,'N','CHF','2026-01-01'), ($1,$2,1,9.48,'N','CHF','2026-01-02')`,
    [uid, SN],
  );
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,4,'manual')`, [uid, PN]);
  await db.run(
    `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency)
                VALUES ($1,$2,4,3,0.6,'N','CHF')`,
    [uid, PN],
  );
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FN]);
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency)
                VALUES ($1,$2,2,NULL,'U','CHF')`,
    [uid, FN],
  );

  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  for (const [art, pfad, erwartet] of /** @type {[string, string, object][]} */ ([
    ['sets', `sets/${SN}/acquisitions`, { quantity: 3, amount: 24.3, priced_rows: 2, currency: 'CHF', ohne_kurs: 0 }],
    [
      'parts',
      `parts/${PN}/4/acquisitions`,
      { quantity: 3, amount: 1.8, priced_rows: 1, currency: 'CHF', ohne_kurs: 0 },
    ],
    ['minifigs', `minifigs/${FN}/acquisitions`, { quantity: 2, priced_rows: 0, currency: 'CHF', ohne_kurs: 0 }],
  ])) {
    const r = await (await fetch(`${base}/api/v1/${pfad}`)).json();
    assert.equal(r.acquisitions?.length > 0, true, `${art}: keine Erfassungen in der Antwort`);
    assert.deepEqual(r.totals, erwartet, art);
  }
});

test('no UI computes the sum again', async () => {
  // The server sends the total row as `totals`; here deliberately NOT the sum of the rows
  // (10 + 20 at quantity 2): what the UI shows must come from the server.
  const SET = { set_number: '10294-1', name: 'Titanic', year: 2021, quantity: 2 };
  const zeile = (id, preis) => ({
    id,
    quantity: 1,
    purchase_price: preis,
    condition: 'N',
    currency: 'EUR',
    created_at: '2026-10-01T10:00:00Z',
    user_id: 1,
  });
  const { d } = await openUi({
    '/v1/sets': { success: true, total: 1, themes: [], sets: [SET] },
    '/v1/sets/10294-1': { success: true, set: SET },
    '/v1/sets/10294-1/acquisitions': {
      success: true,
      acquisitions: [zeile(1, 10), zeile(2, 20)],
      totals: { quantity: 5, amount: 99, currency: 'EUR' },
    },
  }).then(async o => {
    assert.ok(await warte(() => o.d.querySelector('#gallery [data-click="openModal"]')));
    o.d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => o.d.querySelector('[data-click="openAcqModal"]')), 'Kein Knopf zu den Kaufpreisen');
    o.d.querySelector('[data-click="openAcqModal"]').click();
    assert.ok(await warte(() => o.d.getElementById('acq-total-price')), 'Keine Summenzeile');
    return o;
  });
  try {
    assert.equal(d.getElementById('acq-total-qty').textContent.trim(), '5');
    assert.match(d.getElementById('acq-total-price').textContent, /99[.,]00/);
  } finally {
    d.defaultView.close();
  }
});
