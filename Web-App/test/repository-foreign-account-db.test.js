/**
 * Second line in the repository: the writing functions for acquisitions
 * change, delete and move only rows of the passed accounts, even if
 * a caller forgets the check in the write scope. Measured against the
 * real database, the functions are called directly.
 *
 * Counter-checks (measured on 08.11.2026, each on its own):
 *   A  `AND user_id = ANY($3)` removed in setEntryQuantity() → red:
 *      “quantity, price, condition and date of a foreign entry stay”
 *   B  the same in shortenEntry() → red: “a foreign manual entry
 *      can neither be shortened nor removed”
 *   C  the account condition removed in deleteEntry() (src/inventory/repository/acquisitions.ts) → red: “a
 *      foreign entry cannot be deleted from a move”
 *   D  in removeManual() `AND user_id = $2` removed on the inventory row
 *      → red: “the inventory row of a foreign account stays”
 *   (In each case also the own side: “counter-check: with the right account
 *   the same function works” stays green.)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const erf = _req('src/inventory/repository/acquisitions.js');
const manuell = {
  ..._req('src/inventory/repository/manualQuantities.js'),
  ...require('./helpers/sources').testArea('inventory').manualQuantities,
};
const various = {
  ..._req('src/inventory/repository/reassign.js'),
  deleteSetEntry: (tx, id, [konto]) => erf.deleteEntry(tx, 'set', id, konto),
  deleteManualEntry: _req('src/inventory/repository/manualQuantities.js').removeEntry,
};

test('repository only writes to passed accounts', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const name = n => `zl_${process.pid}_${n}`;
  const konto = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [name(n)])).id;
  const eigen = await konto('eigen');
  const fremd = await konto('fremd');
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[eigen, fremd]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const ein = fn => db.transaction(fn);

  // One set per acquisition: per day and set only one acquisition is allowed.
  let zaehler = 0;
  const setEntry = async uid => {
    const sn = `7519${++zaehler}-1`;
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid, sn]);
    return (
      await db.get(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
     VALUES ($1,$2,3,10,'N','EUR') RETURNING id`,
        [uid, sn],
      )
    ).id;
  };
  const lies = (tabelle, id) => db.get(`SELECT * FROM ${tabelle} WHERE id = $1`, [id]);

  await t.test('quantity, price, condition and date of a foreign entry stay', async () => {
    const id = await setEntry(fremd);
    await ein(async tx => {
      await erf.setEntryQuantity(tx, 'set', id, 99, [eigen]);
      await erf.setEntryPrice(tx, 'set', id, 1, true, [eigen]);
      await erf.setEntryState(tx, 'set', id, 'U', [eigen]);
      await erf.setEntryDate(tx, 'set', id, '2020-01-02', [eigen]);
    });
    const z = await lies('set_acquisitions', id);
    assert.deepEqual([z.quantity, Number(z.purchase_price), z.condition, z.price_estimated], [3, 10, 'N', false]);
  });

  await t.test('counter-check: with the right account the same function works', async () => {
    const id = await setEntry(fremd);
    await ein(async tx => {
      await erf.setEntryQuantity(tx, 'set', id, 99, [eigen, fremd]);
      await erf.setEntryPrice(tx, 'set', id, 1, true, [fremd]);
      await erf.setEntryState(tx, 'set', id, 'U', [fremd]);
      await erf.setEntryDate(tx, 'set', id, '2020-01-02', [fremd]);
    });
    const z = await lies('set_acquisitions', id);
    assert.deepEqual([z.quantity, Number(z.purchase_price), z.condition, z.price_estimated], [99, 1, 'U', true]);
    assert.equal((await db.get('SELECT day::text AS t FROM set_acquisitions WHERE id = $1', [id])).t, '2020-01-02');
  });

  await t.test('a foreign manual entry can neither be shortened nor removed', async () => {
    const id = (
      await db.get(
        `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, currency) VALUES ($1,'3001',5,4,'EUR') RETURNING id`,
        [fremd],
      )
    ).id;
    await ein(async tx => {
      await manuell.shortenEntry(tx, 'part', id, 1, [eigen]);
      await manuell.removeEntry(tx, 'part', id, [eigen]);
    });
    assert.equal((await lies('part_acquisitions', id)).quantity, 4);
    await ein(tx => manuell.shortenEntry(tx, 'part', id, 1, [fremd]));
    assert.equal((await lies('part_acquisitions', id)).quantity, 3, 'counter-check: the own account shortens');
    await ein(tx => manuell.removeEntry(tx, 'part', id, [fremd]));
    assert.equal(await lies('part_acquisitions', id), undefined, 'counter-check: the own account removes');
  });

  await t.test('a foreign entry cannot be deleted from a move', async () => {
    const setId = await setEntry(fremd);
    const figId = (
      await db.get(
        `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, currency) VALUES ($1,'fig-000001',1,'EUR') RETURNING id`,
        [fremd],
      )
    ).id;
    await ein(async tx => {
      await various.deleteSetEntry(tx, setId, [eigen]);
      await various.deleteManualEntry(tx, 'fig', figId, [eigen]);
    });
    assert.ok(await lies('set_acquisitions', setId));
    assert.ok(await lies('minifig_acquisitions', figId));
    await ein(async tx => {
      await various.deleteSetEntry(tx, setId, [fremd]);
      await various.deleteManualEntry(tx, 'fig', figId, [fremd]);
    });
    assert.equal(await lies('set_acquisitions', setId), undefined, 'counter-check: the own account deletes');
    assert.equal(await lies('minifig_acquisitions', figId), undefined);
  });

  await t.test('the inventory row of a foreign account stays', async () => {
    const row = (
      await db.get(
        `INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,'fig-000002','manual') RETURNING id`,
        [fremd],
      )
    ).id;
    await ein(tx => various.removeManual(tx, 'fig', eigen, ['fig-000002'], row));
    assert.ok(await lies('minifigs', row), "with the sender's account it is a foreign row");
    await ein(tx => various.removeManual(tx, 'fig', fremd, ['fig-000002'], row));
    assert.equal(await lies('minifigs', row), undefined, 'counter-check: the own account removes');
  });
});
