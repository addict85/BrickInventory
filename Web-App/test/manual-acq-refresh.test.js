/**
 * Acquisition list in the detail dialog of manual parts and minifigures.
 *
 * The quantity and daily rules run against the database, the reloading of the
 * list in the whole UI (jsdom).
 *
 * Counter-checks (measured 08.11.2026, each reverted):
 *   A  manQtySave() loads the list only when increasing (`if (qty > 2)` around the
 *      fetch) → red “the acquisition list is reloaded in BOTH directions”
 *   B  passeManualQuantityAn: `if (soll > bisher)` → `if (soll > bisher && bisher > 0)`
 *      → red “a quantity increase creates even without an existing acquisition …”
 *   C  entriesNewestFirst sorts ASC → red “the LIFO reduction …”
 *   D  ENTRY_TABLES: key of the part without color_id → red “the
 *      daily rule applies to all three kinds …” (plus “increase …” and “edit path …”)
 *   E  in src/collection/acquisitions.ts `if (clash)` → `if (false)` → red “the
 *      edit path rejects what the daily rule forbids” (500 instead of 409)
 *   F  deletePart() without deletePartEntries → red “deleting a
 *      manual entry clears the purchase prices along”
 *   G  valueManual() with `acquisitions: []` instead of `rows` → red “the
 *      valuation delivers one row per purchase price …”
 *   H  pmRows() always draws only one row (`return pmRow(it, label, null,
 *      situation, text)`) → red “the finances show one row per purchase price …”
 *   I  in src/collection/deletion.ts `.catch(() => {})` on deletePartEntries → red in
 *      ratschen.test.js “silent catches …” (covers the deleted case “no
 *      silent error on stock tables any more”)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = f => require('./helpers/sources').serviceSource(f);
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('the acquisition list is reloaded in BOTH directions', async t => {
  // When decreasing, the server removes acquisitions; reloading only when
  // increasing left deleted entries standing in the dialog.
  const { openUi, switchTab } = require('./helpers/ui');
  const row = (id, quantity, tag) => ({
    id,
    quantity: quantity,
    purchase_price: 0.5,
    unit_price: 0.5,
    condition: 'N',
    created_at: `${tag}T10:00:00Z`,
    currency: 'EUR',
    user_id: 1,
  });
  let acqList = [row(1, 1, '2026-10-01'), row(2, 1, '2026-10-02')];
  const { w, d, waitFor, calls } = await openUi({
    '/v2/parts/manual': {
      success: true,
      total: 1,
      page: 1,
      page_size: 50,
      parts: [
        { part_number: '3002', part_name: 'Stein 2 x 3', color_id: 5, color_name: 'Red', quantity: 2, user_id: 1 },
      ],
    },
    '/v2/parts/3002/5/acquisitions': () => ({ success: true, acquisitions: acqList }),
    '/v2/parts/3002/5': { success: true, quantity: 1 },
  });
  t.after(() => w.close());
  await switchTab(w, 'parts');
  assert.ok(
    await waitFor(() => d.querySelector('#manual-parts-list .man-tile')),
    'The tile of the manual part is missing',
  );
  d.querySelector('#manual-parts-list .man-tile').click();
  assert.ok(await waitFor(() => d.getElementById('man-det-qty')), 'The quantity field in the detail is missing');
  const prior = d.getElementById('man-acq-summary')?.textContent;

  acqList = [row(1, 1, '2026-10-01')];
  const ab = calls.length;
  const field = /** @type {HTMLInputElement} */ (d.getElementById('man-det-qty'));
  field.value = '1';
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.ok(await waitFor(() => calls.slice(ab).some(a => a.method === 'PUT')), 'The quantity is not saved');
  assert.ok(
    await waitFor(() =>
      calls.slice(ab).some(a => a.method === 'GET' && a.url.includes('/v2/parts/3002/5/acquisitions')),
    ),
    'After decreasing, the acquisition list is not fetched again',
  );
  assert.ok(
    await waitFor(() => d.getElementById('man-acq-summary')?.textContent !== prior),
    'The summary in the detail still shows the deleted acquisition',
  );
});

test('quantities and acquisitions of manual entries against the database', { concurrency: 1 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `macq_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { changeManualPart } = _req('src/parts/manualParts.js');
  const { updateManualMinifig } = _req('src/minifigs/manualMinifigs.js');
  const { addPurchaseAtTag } = _req('src/inventory/acquisitions.js');
  const { testServer } = require('./helpers/server');
  const { base } = testServer(_req, { session: { userId: uid }, t });
  const partRows = (pn, cid = 5) =>
    db.all(
      `SELECT id, quantity FROM part_acquisitions WHERE user_id = $1 AND part_number = $2 AND color_id = $3
      ORDER BY created_at, id`,
      [uid, pn, cid],
    );

  await t.test('a quantity increase creates a row even without an existing acquisition', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-leer', 5, 'manual')`, [
      uid,
    ]);
    await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, 'ma-fig-leer', 'manual')`, [uid]);
    await changeManualPart(uid, 'ma-leer', 5, { quantity: 3 });
    await updateManualMinifig(uid, 'ma-fig-leer', { quantity: 2 });
    assert.deepEqual(
      (await partRows('ma-leer')).map(r => r.quantity),
      [3],
      'The quantity rose, the acquisition list stayed empty',
    );
    const fig = await db.get(
      `SELECT COALESCE(SUM(quantity),0)::int AS q FROM minifig_acquisitions
                               WHERE user_id = $1 AND fig_number = 'ma-fig-leer'`,
      [uid],
    );
    assert.equal(fig.q, 2, 'For the minifigure the quantity rose without an acquisition');
  });

  await t.test('the LIFO reduction removes the newest acquisition first', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-lifo', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
                  VALUES ($1, 'ma-lifo', 5, 2, 1, 'N', NOW() - INTERVAL '3 days'),
                         ($1, 'ma-lifo', 5, 1, 2, 'N', NOW())`,
      [uid],
    );
    const [alt] = await partRows('ma-lifo');
    await changeManualPart(uid, 'ma-lifo', 5, { quantity: 2 });
    assert.deepEqual(
      await partRows('ma-lifo'),
      [{ id: alt.id, quantity: 2 }],
      "When decreasing, today's acquisition must go first, not the oldest",
    );
    await changeManualPart(uid, 'ma-lifo', 5, { quantity: 1 });
    assert.deepEqual(await partRows('ma-lifo'), [{ id: alt.id, quantity: 1 }]);
  });

  await t.test('the daily rule applies to all three kinds with their own key', async () => {
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, 'ma-1') ON CONFLICT DO NOTHING`, [uid]);
    const record = (kind, keys) => addPurchaseAtTag(kind, uid, keys, { quantity: 1, price: 4, condition: 'N' });
    for (const [kind, keys] of [
      ['set', ['ma-1']],
      ['part', ['ma-tag', 5]],
      ['fig', ['ma-fig-tag']],
    ]) {
      assert.deepEqual(await record(kind, keys), { merged: false }, `${kind}: the first acquisition of the day`);
      assert.deepEqual(
        await record(kind, keys),
        { merged: true },
        `${kind}: the second purchase on the same day does not top up`,
      );
    }
    // Another color is another part, not a second purchase.
    assert.deepEqual(
      await record('part', ['ma-tag', 7]),
      { merged: false },
      'A different colour was merged with the first one',
    );
    assert.deepEqual(
      (await partRows('ma-tag', 5)).map(r => r.quantity),
      [2],
    );
    assert.deepEqual(
      (await partRows('ma-tag', 7)).map(r => r.quantity),
      [1],
    );
  });

  await t.test('the edit path rejects what the daily rule forbids', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-datum', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
                  VALUES ($1, 'ma-datum', 5, 1, 1.5, 'N', NOW()),
                         ($1, 'ma-datum', 5, 1, 1.5, 'N', NOW() - INTERVAL '5 days')`,
      [uid],
    );
    const [earlier, todayDate] = await partRows('ma-datum');
    const tag = async id =>
      (
        await db.get(
          `SELECT to_char(COALESCE(day, (created_at AT TIME ZONE 'UTC')::date), 'YYYY-MM-DD') AS t
         FROM part_acquisitions WHERE id = $1`,
          [id],
        )
      ).t;
    const changeOne = (id, body) =>
      fetch(`${base}/api/v2/parts/ma-datum/5/acquisitions/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const r = await changeOne(earlier.id, { date: await tag(todayDate.id) });
    assert.equal(r.status, 409, 'A date on which the same purchase already exists must be rejected');
    assert.equal((await r.json()).code, 'date_taken');
    assert.equal(
      (await changeOne(earlier.id, { date: await tag(todayDate.id), condition: 'U' })).status,
      200,
      'A different condition on the same day is a separate acquisition and allowed',
    );
  });

  await t.test('deleting a manual entry clears the purchase prices along', async () => {
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-weg', 5, 'manual')`, [
      uid,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price)
                  VALUES ($1, 'ma-weg', 5, 2, 3)`,
      [uid],
    );
    const r = await fetch(`${base}/api/v2/parts/ma-weg/5`, { method: 'DELETE' });
    assert.equal(r.status, 200, await r.text());
    assert.deepEqual(await partRows('ma-weg'), [], 'Orphaned acquisitions still count in the finance totals');
  });

  await t.test('the valuation delivers one row per purchase price, legacy data without', async () => {
    const { valueParts, valueMinifigs } = _req('src/finances/financeCalc.js');
    await db.run(
      `INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, 'ma-preis', 5, 'manual'),
                  ($1, 'ma-alt', 5, 'manual')`,
      [uid],
    );
    await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1, 'ma-fig-preis', 'manual')`, [uid]);
    for (const [tag, price] of [
      [3, 2],
      [1, 4],
    ]) {
      await db.run(
        `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, created_at)
                    VALUES ($1, 'ma-preis', 5, 1, $2, NOW() - make_interval(days => $3))`,
        [uid, price, tag],
      );
      await db.run(
        `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, created_at)
                    VALUES ($1, 'ma-fig-preis', 1, $2, NOW() - make_interval(days => $3))`,
        [uid, price, tag],
      );
    }
    const parts = (await valueParts(uid, [uid])).parts;
    const minifigs = (await valueMinifigs(uid, [uid])).figs;
    const prices = e => (e?.acquisitions ?? []).map(a => a.purchase_price).sort();
    assert.deepEqual(prices(parts.find(p => p.part_number === 'ma-preis')), [2, 4], 'part: one row per purchase price');
    assert.deepEqual(
      prices(minifigs.find(f => f.fig_number === 'ma-fig-preis')),
      [2, 4],
      'figure: one row per purchase price',
    );
    assert.deepEqual(parts.find(p => p.part_number === 'ma-alt')?.acquisitions, [], 'legacy stock without acquisition');
  });
});

test('the finances show one row per purchase price, the legacy data in one', async t => {
  const { openUi, switchTab } = require('./helpers/ui');
  const acquisition = (id, price) => ({
    id,
    condition: 'N',
    quantity: 1,
    purchase_price: price,
    avg_price: 3,
    total_avg: '3.00',
    value_total: 3,
    pnl_pct: null,
    pnl_percent: null,
  });
  const part = (nr, acquisitions) => ({
    part_number: nr,
    part_name: `Teil ${nr}`,
    color_id: 5,
    color_name: 'Red',
    quantity: acquisitions.length || 1,
    condition: 'N',
    conditions: ['N'],
    acquisitions,
    avg_price: 3,
    purchase_price: 3,
    value_total: 3 * (acquisitions.length || 1),
    total_value: '3.0000',
    display_value: '3.00',
  });
  const { w, d, waitFor } = await openUi({
    '/v2/finance/parts-valuation': {
      success: true,
      currency: 'EUR',
      total_value: '9.00',
      value_total: 9,
      parts: [part('ma-zwei', [acquisition(1, 2), acquisition(2, 4)]), part('ma-alt', [])],
    },
  });
  t.after(() => w.close());
  await switchTab(w, 'finance');
  assert.ok(await waitFor(() => d.querySelector('[data-fin-kind] tbody tr')), 'No section for manual parts');
  const lines = [...d.querySelectorAll('[data-fin-kind] tbody tr')].map(z => z.textContent);
  assert.equal(lines.filter(z => z.includes('Teil ma-zwei')).length, 2, lines.join('\n'));
  assert.equal(lines.filter(z => z.includes('Teil ma-alt')).length, 1, lines.join('\n'));
});

test('no create path writes directly into an acquisition table', () => {
  // Prohibition: acquisitions only arise via addPurchaseAtTag — otherwise
  // the daily rule (entry-per-state-db.test.js) would not apply to every path.
  for (const f of [
    'src/parts/manualParts.ts',
    'src/minifigs/manualMinifigs.ts',
    'routes/api/sets.ts',
    'routes/api/setsImport.ts',
    'src/sets/service.ts',
    'src/sets/content.ts',
  ]) {
    const src = strip(read(f));
    assert.doesNotMatch(
      src,
      /INSERT INTO (part|minifig|set)_acquisitions/,
      `${f}: acquisitions must be written via addPurchaseAtTag`,
    );
  }
  for (const f of [
    'routes/api/sets.ts',
    'routes/api/setsImport.ts',
    'src/parts/manualParts.ts',
    'src/minifigs/manualMinifigs.ts',
    'routes/api/acquisitions.ts',
    'src/collection/acquisitions.ts',
  ]) {
    assert.doesNotMatch(
      strip(read(f)),
      /SELECT id FROM \w+_acquisitions WHERE[\s\S]{0,160}created_at[^\n]*::date/,
      `${f}: no own copy of the per-day check`,
    );
  }
});

test('the quantity increase averages the purchase price instead of leaving it', () => {
  // The earlier branch only increased the quantity for an acquisition of today. A
  // copy bought today at the current market price thereby vanished into the
  // old unit price — the row showed two pieces at the price of the first.
  const src = require('./helpers/sources').compact(require('./helpers/sources').setCoreSource());
  const fn = src.slice(
    src.indexOf('async function alignEntriesToQuantity'),
    src.indexOf('async function writeInLastEntry'),
  );
  assert.doesNotMatch(
    fn,
    /UPDATE set_acquisitions SET quantity = quantity \+ \$1/,
    'No direct topping up any more — addPurchaseAtTag decides that',
  );
  assert.match(
    fn,
    /await bookEntry\(sk, \{\s*account: userId,\s*setNumber,\s*quantity: delta,\s*purchasePrice: plan\.price,\s*condition: plan\.condition,/,
    'The increase also goes through the shared write path',
  );
  // The price comes from priceForNewEntry() — extracted, because the
  // BrickLink fetch in it must run BEFORE the advisory lock (a network call
  // in an open transaction would hold lock and connection).
  assert.match(
    fn,
    /pricePlan \?\? \(?await priceForNewEntry\(sk, userId, setNumber\)/,
    'A price determined beforehand must be passable through',
  );
  // Target of the quantity change is the account `ziel` (without a setting the own one, in the household the chosen one).
  // The checked RULE is unchanged: determine the price (network call), THEN lock.
  assert.match(
    src,
    /const plan = [\s\S]{0,120}priceForNewEntry\(sk, target, sn\)[\s\S]{0,400}sk\.transact\(/,
    'In changeSet the price must come BEFORE the lock',
  );
  assert.doesNotMatch(src, /function isToday\(/, 'The own per-day check must be removed');
});

test('a quantity change runs under the inventory lock', () => {
  // Where this test comes from
  const src = require('./helpers/sources').setCoreSource();
  const fn = src
    .slice(src.indexOf('async function changeSet'), src.indexOf("router.put('/:setNumber'"))
    // Comments gone: the explanatory text above quotes the old call including
    // .catch(() => {}) and would otherwise trigger the check itself.
    .replace(/\/\/[^\n]*/g, '');
  // Target is the account `ziel` — the rule stays: ONE locked transaction for quantity and acquisitions.
  assert.match(
    fn,
    /locks: \[\{ account: target, key: sn \}\]/,
    'Quantity and acquisitions belong in ONE locked transaction',
  );
  assert.doesNotMatch(
    fn,
    /alignEntriesToQuantity\([^)]*\)\.catch\(/,
    'A swallowed error leaves a quantity without matching acquisitions',
  );
  assert.doesNotMatch(
    fn,
    /await db\.run\('UPDATE sets SET quantity/,
    'The quantity change must not bypass the transaction',
  );
  // And the difference must come from the TOTAL QUANTITY of the scope, not
  // from the row of a single account — otherwise the detail would show a
  // household number while the „+" calculated against another one.
  // Since migration 0036 the query stands in db/stockQuantity.ts; here …
  assert.match(
    fn,
    /repo\.setQuantity\(s\.db, 'blickfeld', readField/,
    'The starting quantity must be summed over the scope',
  );
});
