/**
 * The count shows the HOUSEHOLD — what is changed is the OWN account.
 *
 * Counter-check (carried out): target set back to `ownerId` → the
 * increase substep turns red (the copies land at the sub-account).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet, quantityOf } = require('./helpers/inventory');
const db = testData();

test('quantity: display = household, change = own account', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `mh-${process.pid}`,
    SUB = `ms-${process.pid}`;
  const SN = `78${(process.pid % 900) + 100}-1`;

  const cleanUp = async () => {
    for (const tab of ['sets', 'set_acquisitions', 'price_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);
  await cleanUp();
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                ON CONFLICT (key) DO UPDATE SET value='EUR'`);
  await db.run(
    `INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                VALUES ($1,'U','EUR',3.94,3.94,3)`,
    [SN],
  );
  // ONLY the sub-account holds a copy — Marco's starting situation.
  await holdsSet(db, subId, SN, 0); // quantity 0: the acquisition behind it carries it
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,3.94,'U',1)`,
    [subId, SN],
  );

  const { base, srv } = testServer(_req, { session: { userId: mainId }, t });

  const detail = async () => (await (await fetch(`${base}/api/v2/sets/${SN}`)).json()).set;
  const put = async n => {
    const r = await fetch(`${base}/api/v2/sets/${SN}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: n }),
    });
    return { status: r.status, body: await r.json() };
  };
  // From the acquisitions (migration 0036 deleted sets.quantity).
  const quantity = async uid => await quantityOf(db, uid, SN);

  try {
    await t.test('the detail shows the quantity of all accounts', async () => {
      const d = await detail();
      assert.equal(
        d.quantity,
        1,
        "The detail shows a single account's row instead of the total — that is exactly " +
          "how Marco's „Anzahl 0“ came about",
      );
    });

    await t.test('increasing creates in the OWN account, with market price', async () => {
      const r = await put(2);
      assert.equal(r.status, 200);
      assert.equal(await quantity(mainId), 1, 'the difference belongs to the own account');
      assert.equal(await quantity(subId), 1, 'the foreign stock stays untouched');
      const acq = await db.get(
        `SELECT quantity, purchase_price, condition FROM set_acquisitions
          WHERE user_id=$1 AND set_number=$2`,
        [mainId, SN],
      );
      assert.ok(acq, 'no acquisition was created in the own account');
      assert.equal(acq.quantity, 1);
      assert.equal(
        Number(acq.purchase_price),
        3.94,
        'the acquisition needs the MARKET PRICE — „analog der bestehenden Logik“',
      );
      assert.equal(acq.condition, 'U', 'the condition comes from the same determination as when recording');
      assert.equal((await detail()).quantity, 2);
      assert.equal(r.body.quantity, 2, 'the response carries the new total quantity');
    });

    await t.test('increasing again merges on the same day', async () => {
      // The daily rule applies unchanged: one acquisition per account, set and day.
      await put(4);
      const lines = await db.all(`SELECT quantity FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [
        mainId,
        SN,
      ]);
      assert.equal(lines.length, 1, `${lines.length} acquisitions — the per-day rule does not apply`);
      assert.equal(lines[0].quantity, 3);
      assert.equal(await quantity(mainId), 3);
    });

    await t.test('decreasing takes the own copies first', async () => {
      await put(1);
      assert.equal(await quantity(mainId), 0, 'the own copies go first');
      assert.equal(await quantity(subId), 1, 'the foreign one stays');
      // If nothing remains, the own row disappears entirely.
      const owned = await db.get(`SELECT COUNT(*)::int c FROM sets WHERE user_id=$1 AND set_number=$2`, [mainId, SN]);
      assert.equal(owned.c, 0, 'an own row with quantity 0 stays behind');
    });

    await t.test('it cannot go below the own stock', async () => {
      // The copies of another account are not mine. Instead of taking
      // them away, the server caps — and says in the response what
      // actually applies.
      const r = await put(0);
      assert.equal(await quantity(subId), 1, 'the foreign copy was taken away');
      assert.equal(r.body.quantity, 1, 'the response must name the REAL quantity, not the one sent');
    });
  } finally {
    await cleanUp();
    await db.run(`DELETE FROM account_links WHERE main_user_id=$1`, [mainId]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
