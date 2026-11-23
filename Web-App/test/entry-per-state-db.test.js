/**
 * Two conditions on the same day are TWO entries, with their own prices.
 *
 * ── Counter-checks (MEASURED on 21.10., numbers copied down) ─────────────────
 *
 * Starting point `# pass 6 / # fail 0` (five cases and their shell).
 *
 *   A  `AND COALESCE(condition, 'N') = $…` removed from addPurchaseAtTag
 *      (the state of Marco's finding)
 *      → `pass 2 / fail 4`. Red are THREE cases: “two conditions, two
 *        rows" (`1 row(s) instead of 2`), “every row keeps its own
 *        price" and “the date endpoint looks at the condition" — the last
 *        only indirectly, because the N row it searches for was never created.
 *        “The same condition still tops up" stays green: this half
 *        of the rule does not change.
 *   B  migration 0040 reverted (old index without condition)
 *      → `pass 1 / fail 5`. Red are FOUR cases. The index already prevents the
 *        second row in the database, and everything that builds on it
 *        falls with it. That is the proof that the migration carries and not
 *        only the code.
 *   C  the condition removed from purchaseAtSameTag
 *      → `pass 4 / fail 2`. Red: “the date endpoint looks at the condition".
 *        Without it the edit path rejects what the create path just
 *        allowed — exactly the contradiction for which this version was once
 *        discarded.
 *
 * Counter-checks for migration 0047 (measured on 28.10.):
 *   D  addPurchaseAtTag again as read-compute-write (state before
 *      0047) → red: “concurrent entries are not lost" (fewer
 *      than 12) and “equal price tops up …" (mixed price 3)
 *   E  price_estimated removed from index and insert → red: “an
 *      inserted market price is marked as estimated"
 *   F  the migration's currency trigger removed → red: all cases, because
 *      without it the required column currency rejects every insert
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { addPurchaseAtTag, purchaseAtSameTag } = _req('src/inventory/acquisitions.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('one acquisition per day, condition, price and currency', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  const UID = (await db.get(`INSERT INTO users (username,password_hash) VALUES ('marco','x') RETURNING id`)).id;
  const TAG = '2026-10-21';

  /** The entries of a part, prepared for comparison. */
  const lines = async nr =>
    (
      await db.all(
        `SELECT quantity, unit_price::float AS price, COALESCE(condition,'N') AS condition
       FROM part_acquisitions WHERE user_id=$1 AND part_number=$2
      ORDER BY condition`,
        [UID, nr],
      )
    ).map(z => ({ quantity: Number(z.quantity), price: z.price, condition: z.condition }));

  await t.test('two conditions, two rows', async () => {
    await addPurchaseAtTag('part', UID, ['3001', 4], {
      quantity: 3,
      price: 1.5,
      condition: 'N',
      createdAt: TAG,
    });
    await addPurchaseAtTag('part', UID, ['3001', 4], {
      quantity: 2,
      price: 0.5,
      condition: 'U',
      createdAt: TAG,
    });
    const z = await lines('3001');
    assert.equal(
      z.length,
      2,
      `${z.length} row(s) instead of 2: ${JSON.stringify(z)}. Previously the ` +
        'used purchase was folded into the new one — Marco’s finding',
    );
  });

  await t.test('every row keeps its own price', async () => {
    assert.deepEqual(
      await lines('3001'),
      [
        { quantity: 3, price: 1.5, condition: 'N' },
        { quantity: 2, price: 0.5, condition: 'U' },
      ],
      'The blended price 1.10 would be the old calculation over two different purchases',
    );
  });

  await t.test('the same price tops up, a different price gets a row of its own', async () => {
    // Since migration 0047: no more mixed price. Equal purchases of a day
    // are added (lossless), different prices stay separate.
    await addPurchaseAtTag('part', UID, ['3002', 4], {
      quantity: 2,
      price: 2.0,
      condition: 'N',
      createdAt: TAG,
    });
    await addPurchaseAtTag('part', UID, ['3002', 4], {
      quantity: 1,
      price: 2.0,
      condition: 'N',
      createdAt: TAG,
    });
    await addPurchaseAtTag('part', UID, ['3002', 4], {
      quantity: 2,
      price: 4.0,
      condition: 'N',
      createdAt: TAG,
    });
    assert.deepEqual(
      (await lines('3002')).sort((x, y) => x.price - y.price),
      [
        { quantity: 3, price: 2, condition: 'N' },
        { quantity: 2, price: 4, condition: 'N' },
      ],
      'The single purchases must remain reconstructible — no blended price 3',
    );
  });

  await t.test('concurrent acquisitions do not get lost', async () => {
    // Web and app enter the same part at the same moment.
    await Promise.all(
      Array.from({ length: 12 }, () =>
        addPurchaseAtTag('part', UID, ['3004', 1], { quantity: 1, price: 1.0, condition: 'N', createdAt: TAG }),
      ),
    );
    const z = await lines('3004');
    assert.deepEqual(
      z,
      [{ quantity: 12, price: 1, condition: 'N' }],
      `Instead of 12, ${z.reduce((s, r) => s + r.quantity, 0)} arrived: ${JSON.stringify(z)}`,
    );
  });

  await t.test('an inserted market price is marked as estimated', async () => {
    await addPurchaseAtTag('part', UID, ['3005', 1], {
      quantity: 1,
      price: 0.3,
      condition: 'N',
      createdAt: TAG,
      estimated: true,
    });
    await addPurchaseAtTag('part', UID, ['3005', 1], {
      quantity: 1,
      price: 0.3,
      condition: 'N',
      createdAt: TAG,
    });
    const z = await db.all(
      `SELECT quantity, price_estimated FROM part_acquisitions
        WHERE user_id = $1 AND part_number = '3005' ORDER BY price_estimated`,
      [UID],
    );
    assert.deepEqual(
      z.map(r => [Number(r.quantity), r.price_estimated]),
      [
        [1, false],
        [1, true],
      ],
      'An estimated and a paid price of the same amount must not merge',
    );
  });

  await t.test('every acquisition carries the currency of its account', async () => {
    await db.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')
                  ON CONFLICT (user_id, key) DO UPDATE SET value = 'CHF'`,
      [UID],
    );
    await addPurchaseAtTag('part', UID, ['3006', 1], { quantity: 1, price: 5, condition: 'N', createdAt: TAG });
    await db.run(`UPDATE user_settings SET value = 'EUR' WHERE user_id = $1 AND key = 'currency'`, [UID]);
    await addPurchaseAtTag('part', UID, ['3006', 1], { quantity: 1, price: 5, condition: 'N', createdAt: TAG });
    const z = await db.all(
      `SELECT currency FROM part_acquisitions WHERE user_id = $1 AND part_number = '3006' ORDER BY currency`,
      [UID],
    );
    assert.deepEqual(
      z.map(r => r.currency),
      ['CHF', 'EUR'],
      'After the switch the old CHF price must not become the EUR price',
    );
  });

  await t.test('the unique index carries the rule, not only the code', async () => {
    // Migration 0040. Without the index a path that writes past the helper
    // would have free rein — exactly for that it has existed since 0008.
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, condition, created_at)
       VALUES ($1,'3003',4,1,'N',$2::date)`,
      [UID, TAG],
    );
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, condition, created_at)
       VALUES ($1,'3003',4,1,'U',$2::date)`,
      [UID, TAG],
    );
    const twice = db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, condition, created_at)
       VALUES ($1,'3003',4,1,'N',$2::date)`,
      [UID, TAG],
    );
    await assert.rejects(
      twice,
      /duplicate key|unique/i,
      'The database must reject a THIRD row with an already used condition ' +
        '— otherwise the index has become too wide',
    );
  });

  await t.test('the date endpoint looks at the condition', async () => {
    // The second step without which the version was already discarded once:
    // the edit path must not reject what the create path allows.
    const n = await db.get(
      `SELECT id FROM part_acquisitions WHERE user_id=$1 AND part_number='3001'
         AND condition='N'`,
      [UID],
    );
    assert.ok(n, 'Precondition: the N row from above');
    assert.equal(
      await purchaseAtSameTag('part', UID, ['3001', 4], TAG, n.id, 'N', { price: 1.5 }),
      null,
      'Against the OWN condition the day is free — the own row does not count',
    );
    const clash = await purchaseAtSameTag('part', UID, ['3001', 4], TAG, n.id, 'U', { price: 0.5 });
    assert.ok(
      clash,
      'Against the OTHER condition with the same price there is a row. Whoever ' +
        'overlooks it lets a duplicate arise — and the index rejects it',
    );
    assert.equal(
      await purchaseAtSameTag('part', UID, ['3001', 4], TAG, n.id, 'U', { price: 0.9 }),
      null,
      'With a different price it has been a separate row since migration 0047, not a collision',
    );
  });
});
