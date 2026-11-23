/**
 * Both UIs take the quantity from the SERVER RESPONSE.
 *
 * Counter-check (carried out): in sammlung.js `const echt = qty` set →
 * the web app substep turns red. Counter-check of 30.10.2026: in
 * routes/api/sets.ts `...(r || {})` removed from the PUT response → red:
 * “the route delivers the quantity” (undefined instead of 3). Counter-check of 08.11.2026:
 * in autosaveSet `const echt = qty` → red: “the web app takes
 * the quantity from the response” (field stays at 1). Counter-check of 12.11.2026 (the
 * detail rereads after saving): in frischeDetailAuf the setting of
 * m-qty from d.set.quantity removed → red: same place (field empty).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { openUi, waitFor } = require('./helpers/ui');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet } = require('./helpers/inventory');

test('the route delivers the quantity at all', { concurrency: 1 }, async t => {
  // Without the field both clients would silently fall back to their own assumption —
  // the fallback is deliberately silent. The quantity comes from changeSet(),
  // summed over the scope.
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `mengenecho-${process.pid}`,
    SN = `${process.pid}5-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await holdsSet(db, uid, SN, 2);
  const { base } = testServer(_req, { session: { userId: uid }, t });
  const put = async quantity =>
    (
      await fetch(`${base}/api/v2/sets/${SN}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity }),
      })
    ).json();
  assert.equal((await put(3)).quantity, 3, 'the route returns the quantity');
  assert.equal((await put(1)).quantity, 1, 'also after decreasing');
});

test('the web app takes the quantity from the response', async () => {
  // The server caps the reduction (acquisitions of other accounts in the household): it writes 2, not 1.
  // Afterwards the detail rereads the set; the server names the same quantity there.
  const SET = { set_number: '10294-1', name: 'Titanic', year: 2021, quantity: 3 };
  const { w, d, calls } = await openUi({
    '/v2/sets': { success: true, total: 1, themes: [], sets: [SET] },
    '/v2/sets/10294-1': (_url, o) => {
      if (o?.method === 'PUT') SET.quantity = 2;
      return o?.method === 'PUT' ? { success: true, quantity: 2 } : { success: true, set: { ...SET } };
    },
    '/v2/sets/10294-1/acquisitions': { success: true, acquisitions: [] },
  });
  try {
    assert.ok(await waitFor(() => d.querySelector('#gallery [data-click="openModal"]')));
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await waitFor(() => d.getElementById('m-qty')?.value === '3'), 'The detail does not show the quantity');
    d.getElementById('m-qty').value = '1';
    d.getElementById('m-qty').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await waitFor(() => calls.some(a => a.method === 'PUT')), 'The quantity is not saved');
    assert.ok(
      await waitFor(() => d.getElementById('m-qty').value === '2'),
      `The field keeps its own assumption: ${d.getElementById('m-qty').value}`,
    );
  } finally {
    w.close();
  }
});
