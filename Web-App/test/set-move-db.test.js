/**
 * Moving a set between accounts — against a real database.
 *
 * Counter-check (22.11.2026): setEntriesReassign hands the acquisitions over with
 * `UPDATE set_acquisitions SET user_id` instead of bookDailyEntry → red “a moved purchase joins
 * the target's row of the same day” (two rows instead of one).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();

test('move set', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    noDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // And the MIGRATIONS, not only the schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }

  // In one transaction via its context: the collection calls the move like this (t.sets).
  const collection = require('./helpers/sources').testContext('collection');
  // Two foreign accounts: across both only in the system context (the owner role creates the data).
  const { inSystemContext } = _req('src/infra/accountContext.js');
  const setEntriesReassign = (...a) =>
    inSystemContext('Testdaten', () => collection.transact(t => t.sets.setEntriesReassign(...a)));

  await db.run("INSERT INTO users (username,password_hash) VALUES ('mv_a','x'),('mv_b','x')");
  const [a, b] = (await db.all('SELECT id FROM users ORDER BY id')).map(r => r.id);

  /** Create a set with contents at the sender. */
  async function createInventory(sn, parts, minifigs) {
    await holdsSet(db, a, sn, 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,50,'N')`,
      [a, sn],
    );
    for (let i = 0; i < parts; i++) {
      await holdsPart(db, a, `300${i}`, { setNumber: sn, quantity: 2, colorId: 4 });
    }
    for (let i = 0; i < minifigs; i++) {
      await holdsMinifig(db, a, `fig-00${i}`, { setNumber: sn, quantity: 1 });
    }
  }

  await t.test('the run produces no pg warning about parallel queries', async () => {
    await createInventory('10001-1', 3, 2);

    const warnings = [];
    const listener = w => warnings.push(String(w?.message || w));
    process.on('warning', listener);
    try {
      await setEntriesReassign('10001-1', a, b);
      // Warnings run via the event thread — wait briefly, otherwise the
      // message would only arrive after the test and nobody would see it.
      await new Promise(r => setTimeout(r, 50));
    } finally {
      process.off('warning', listener);
    }

    const parallel = warnings.filter(w => /already executing a query/i.test(w));
    assert.deepEqual(
      parallel,
      [],
      'pg reports parallel queries on one connection — from pg 9 on that is an error, not just a warning',
    );
  });

  await t.test('parts and minifigures move along and are counted', async () => {
    await createInventory('10002-1', 4, 1);
    const r = await setEntriesReassign('10002-1', a, b);

    assert.equal(r.parts, 4, `${r.parts} instead of 4 parts reported`);
    assert.equal(r.minifigs, 1, `${r.minifigs} instead of 1 minifigure reported`);
    assert.equal(r.source_emptied, true, 'the last copy is gone — the sender must be empty');

    const onTarget = await db.get(
      `SELECT (SELECT COUNT(*)::int FROM parts    WHERE user_id=$1 AND set_number='10002-1') AS parts,
              (SELECT COUNT(*)::int FROM minifigs WHERE user_id=$1 AND set_number='10002-1') AS minifigs`,
      [b],
    );
    assert.equal(onTarget.parts, 4);
    assert.equal(onTarget.minifigs, 1);
    const onSender = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number='10002-1'`, [a]);
    assert.equal(onSender.c, 0, 'parts without a set stayed behind at the sender');
  });

  await t.test('without contents 0 parts is the right answer, not an error', async () => {
    // Exactly the case from the screenshot: a set for which parts were never
    // imported reports 0 — the number is true, only the message in the
    // app looks like an error.
    await createInventory('10003-1', 0, 0);
    const r = await setEntriesReassign('10003-1', a, b);
    assert.equal(r.parts, 0);
    assert.equal(r.minifigs, 0);
    assert.equal(r.quantity, 1, 'the copy itself must have moved anyway');
  });

  await t.test('if the target already has parts, nothing is copied twice', async () => {
    await createInventory('10004-1', 2, 0);
    await holdsPart(db, b, '3000', { setNumber: '10004-1', quantity: 2, colorId: 4 });
    const r = await setEntriesReassign('10004-1', a, b);
    assert.equal(r.parts, 0, 'parts were copied again although rows existed');
    const n = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number='10004-1'`, [b]);
    assert.equal(n.c, 1, 'duplicate rows — the summary counted the quantity twice');
  });

  await t.test('part move leaves everything to the sender; manual parts stay even with the last copy', async () => {
    // Counter-check (31.10.2026): `if (remaining > 0)` in setMove.ts to `if (false)`
    // → red (sender without set); `<> 'manual'` deleted in entferneSet → red
    // (manual part gone).
    await createInventory('10005-1', 2, 1);
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                  VALUES ($1,'10005-1',1,60,'U',NOW() - interval '2 days')`,
      [a],
    );
    await holdsPart(db, a, '3005', { quantity: 2, colorId: 4 });
    const [first, second] = (
      await db.all("SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number='10005-1' ORDER BY id", [a])
    ).map(r => r.id);
    const z = uid =>
      db.get(
        `SELECT (SELECT COUNT(*)::int FROM sets WHERE user_id=$1 AND set_number='10005-1') AS sets,
              (SELECT COUNT(*)::int FROM parts WHERE user_id=$1 AND set_number='10005-1') AS parts,
              (SELECT COUNT(*)::int FROM minifigs WHERE user_id=$1 AND set_number='10005-1') AS minifigs,
              (SELECT COUNT(*)::int FROM parts WHERE user_id=$1 AND source='manual') AS manual`,
        [uid],
      );

    const r1 = await setEntriesReassign('10005-1', a, b, [first]);
    assert.equal(r1.source_emptied, false);
    assert.deepEqual(await z(a), { sets: 1, parts: 2, minifigs: 1, manual: 1 });
    assert.deepEqual(await z(b), { sets: 1, parts: 2, minifigs: 1, manual: 0 });

    const r2 = await setEntriesReassign('10005-1', a, b, [second]);
    assert.equal(r2.source_emptied, true);
    assert.deepEqual(await z(a), { sets: 0, parts: 0, minifigs: 0, manual: 1 });
  });

  await t.test("a moved purchase joins the target's row of the same day", async () => {
    const sn = '10006-1';
    for (const u of [a, b]) {
      await holdsSet(db, u, sn, 0);
      await db.run(
        `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition) VALUES ($1,$2,1,50,'N')`,
        [u, sn],
      );
    }
    await setEntriesReassign(sn, a, b);
    assert.deepEqual(
      await db.all('SELECT quantity FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [b, sn]),
      [{ quantity: 2 }],
    );
  });

  await db.pool.end().catch(() => {});
});
