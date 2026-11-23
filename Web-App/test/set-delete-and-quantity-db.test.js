/**
 * Deleting a set: at most ONE prompt (only the account choice in a household; the own set goes at
 * once with undo, js/deletion.js), and everything belonging to it goes along.
 * Changing the set count: parts and minifigures follow.
 *
 * Counter-checks (carried out): prompt in the btn-md handler built in again →
 * substep 1 red. `sets` removed from the trigger list → substep 4 red.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { withoutComments, testData } = require('./helpers/sources');
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');

test('deleting asks at most once', async () => {
  // Real bundle in jsdom, the trash on the tile (the detail's trash calls the same delSet()). The own
  // set is restorable: it is deleted without asking.
  // In the household exactly one question with the account choice; cancelling deletes nothing.
  // Counter-checks (22.11.2026, each alone): delSet asks with confirmDelete first → red “own set” (a dialog);
  // deletionChoice without `if (!foreign) return ''` → red the same test; a cancelled choice still deletes
  // (`account === null` check removed) → red “household”.
  const { openUi, waitFor, tick } = require('./helpers/ui');
  const mk = owners => ({ set_number: '10294-1', name: 'Titanic', year: 2021, quantity: 1, owners });
  const deletes = calls => calls.filter(a => a.method === 'DELETE').map(a => a.url.replace(/^.*\/api/, ''));
  const modalOpen = d => d.getElementById('confirm-modal')?.style.display === 'flex';
  for (const [kind, owners] of [
    ['own set', [{ id: 1, username: 'anna' }]],
    [
      'household',
      [
        { id: 1, username: 'anna' },
        { id: 7, username: 'ben' },
      ],
    ],
  ]) {
    const SET = mk(owners);
    const { w, d, calls } = await openUi(
      {
        '/v2/sets/household-members': {
          success: true,
          members: [
            { id: 1, username: 'anna', is_self: true, depth: 0 },
            { id: 7, username: 'ben', is_self: false, depth: 1 },
          ],
        },
        '/v2/sets': { success: true, total: 1, themes: [], sets: [SET] },
        '/v2/sets/10294-1': { success: true, set: SET },
        '/v2/sets/10294-1/acquisitions': {
          success: true,
          acquisitions: [],
          totals: { quantity: 1, amount: null, currency: 'EUR' },
        },
      },
      // jsdom has no CSS.escape; every browser does.
      { before: win => Object.assign(win, { CSS: { escape: x => String(x).replace(/[^\w-]/g, c => `\\${c}`) } }) },
    );
    try {
      const trash = () => d.querySelector('#gallery .delbtn[data-click="delSetStop"]');
      assert.ok(await waitFor(() => trash()), `${kind}: no trash on the tile`);
      trash().click();
      if (kind === 'own set') {
        assert.ok(await waitFor(() => deletes(calls).length === 1), `${kind}: nothing deleted`);
        assert.equal(modalOpen(d), false, `${kind}: a question for a restorable set`);
        assert.deepEqual(deletes(calls), ['/v2/sets/10294-1']);
      } else {
        assert.ok(await waitFor(() => modalOpen(d)), `${kind}: no account choice`);
        d.getElementById('cd-cancel').click();
        await tick(50);
        assert.deepEqual(deletes(calls), [], `${kind}: deleted after cancelling`);
      }
    } finally {
      w.close();
    }
  }
});

test('the quantity multiplication is in all places', () => {
  const h = withoutComments(require('./helpers/sources').handlerSource());
  // Parts and minifigures of a set count PER COPY times the set count.
  const placeList = (h.match(/quantityFrom\('sm', ?1\)/g) || []).length;
  assert.ok(
    placeList >= 3,
    `only ${placeList} places multiply by the set count — expected are ` +
      'at least the parts list, the metrics and the minifigure list',
  );
  // And each of these places needs the JOIN source for it, otherwise the
  // alias `sm` does not exist at all. Without this second assertion the rule would also be
  // green with a multiplication that aborts at runtime.
  assert.ok(
    (h.match(/setQuantityJoin\(/g) || []).length >= 3,
    'Too few JOIN sources: quantityFrom() reads `sm.quantity`, and only ' + 'setQuantityJoin() adds the alias',
  );

  // That the summary follows a quantity change is checked by
  // parts-summary.test.js on the running trigger (migration 0052).
});

test('deletion and quantity change against the database', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const USER = `dl-${process.pid}`;
  const SN = `76${(process.pid % 900) + 100}-1`;

  const cleanUp = async () => {
    for (const tab of ['sets', 'set_acquisitions', 'parts', 'minifigs', 'price_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  await cleanUp();
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                ON CONFLICT (key) DO UPDATE SET value='EUR'`);
  await db.run(
    `INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                VALUES ($1,'N','EUR',20,20,3)`,
    [SN],
  );
  // Only the inventory row: quantity, price and condition stand in the acquisition
  // below (migration 0032 for price and condition, 0036 for the quantity).
  await holdsSet(db, uid, SN, 0);
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,15,'N',1)`,
    [uid, SN],
  );
  // One copy contains 10 parts and 1 minifigure.
  await holdsPart(db, uid, '3001', { setNumber: SN, quantity: 10, colorId: 4 });
  await holdsMinifig(db, uid, 'cty0001', { setNumber: SN, quantity: 1 });

  const { base, srv } = testServer(_req, { session: { userId: uid }, t });

  const H = require('./helpers/sources').handlerModule(_req);
  const put = n =>
    fetch(`${base}/api/v2/sets/${SN}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: n }),
    });

  try {
    await t.test('more sets = more parts and minifigures', async () => {
      let st = await H.getStats([uid]);
      assert.equal(st.total_parts, 10, 'Vorbedingung');
      assert.equal(st.total_minifigs, 1, 'Vorbedingung');

      await put(3);
      st = await H.getStats([uid]);
      assert.equal(st.total_parts, 30, `parts ${st.total_parts} instead of 30`);
      assert.equal(st.total_minifigs, 3, `minifigures ${st.total_minifigs} instead of 3`);

      // The LISTS too, not only the metrics — they query differently.
      const p = await H.partsQuery([uid], {});
      const part = (p.parts || []).find(x => x.part_number === '3001');
      assert.equal(Number(part?.quantity ?? part?.total_quantity), 30, 'the parts list does not multiply');
      const m = await H.readMinifigs([uid], {});
      assert.equal(
        Number(m.figs[0]?.total_quantity ?? m.figs[0]?.quantity),
        3,
        'the minifigure list does not multiply',
      );
      assert.equal((await H.computeMinifigStats([uid])).total_quantity, 3, 'the minifigure metric does not multiply');
    });

    await t.test('fewer sets = fewer parts and minifigures', async () => {
      // The opposite direction: without it the test would also be green if the number
      // only ever grew.
      await put(1);
      const st = await H.getStats([uid]);
      assert.equal(st.total_parts, 10, `parts ${st.total_parts} instead of 10`);
      assert.equal(st.total_minifigs, 1, `minifigures ${st.total_minifigs} instead of 1`);
      // The piece count per copy stays at 10 — multiplying happens when
      // reading, not when writing. Since migration 0038 it no longer stands
      // in `parts` (the column does not exist), but ONCE in the catalog of the
      // set. If 30 stood there, somebody would have calculated the set count into it, and …
      const raw = await db.get(`SELECT quantity FROM set_parts_catalog WHERE set_number=$1 AND part_number='3001'`, [
        SN,
      ]);
      assert.equal(Number(raw.quantity), 10, 'the catalogue piece count must be the one PER COPY');
      // And in `parts` itself there is no quantity any more into which something
      // COULD be calculated. Without this second assertion the
      // test would also be green if the column showed up again.
      const column = await db.get(
        `SELECT 1 AS da FROM information_schema.columns
          WHERE table_name='parts' AND column_name='quantity'`,
      );
      assert.equal(column, undefined, 'parts.quantity is back — then the piece count exists twice again');
    });

    await t.test('deleting takes parts, minifigures and purchase prices along', async () => {
      const r = await fetch(`${base}/api/v2/sets/${SN}`, { method: 'DELETE' });
      assert.equal(r.status, 200);
      for (const tab of ['sets', 'parts', 'minifigs', 'set_acquisitions']) {
        const n = (await db.get(`SELECT COUNT(*)::int c FROM ${tab} WHERE set_number=$1`, [SN])).c;
        assert.equal(n, 0, `${tab}: ${n} row(s) left`);
      }
      const st = await H.getStats([uid]);
      assert.equal(st.total_sets, 0);
      assert.equal(st.total_parts, 0, "the set's parts still count");
      assert.equal(st.total_minifigs, 0, "the set's minifigures still count");
    });
  } finally {
    await cleanUp();
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
