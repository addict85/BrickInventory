/**
 * The price history of a minifigure also finds its prices under the
 * BrickLink number.
 *
 * Counter-check: priceHistoryMinifig() (src/finances/priceHistory.ts) looks only under the own number → red “the figure price history finds the prices under the BrickLink number”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { priceHistoryMinifig } = _req('src/finances/priceHistory.js');
const { holdsMinifig } = require('./helpers/inventory');

test('the figure price history finds the prices under the BrickLink number', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  // minifig_price_history deliberately stands ONLY in db/migrations/0003.
  // initSchema() does not create it; without
  // this step the test would run against a schema that does not exist in
  // operation. The migrations are idempotent and skip already
  // applied states via schema_migrations.
  const migClient = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(migClient);
  } finally {
    migClient.release();
  }

  const p = String(process.pid).slice(-5);
  const USER = `fig_${p}`;
  const OWN = `sw${p}`; // this is how the user captured the figure
  const BL = `sw${p}bl`; // this is how BrickLink knows it
  const WITHOUT_BL = `sw${p}x`; // second figure, entirely without a BrickLink number
  const CURRENCY = 'CHF';

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  // Account currency like the queried one: another one would be converted (migration 0077).
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency',$2)`, [uid, CURRENCY]);

  try {
    // The figure carries a DIFFERENT BrickLink number — the case for which
    // the field exists.
    // Since migration 0037 the number stands in bl_mapping — once per
    // figure, without an account. On the stock row it stood per account.
    await holdsMinifig(db, uid, OWN, { quantity: 0 }); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ('fig',$1,$2)
       ON CONFLICT (type, rb_id) DO UPDATE SET bl_id = EXCLUDED.bl_id`,
      [OWN, BL],
    );
    // The purchase price stands under the user's number.
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
       VALUES ($1,$2,1,4.00,'N')`,
      [uid, OWN],
    );
    // Market price and history stand under the BRICKLINK number — that is how
    // fetchMinifigPrice writes them when the fetch via bl_fig_number worked.
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,'N',$2,9.00,9.00)
       ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=9.00, qty_avg_price=9.00`,
      [BL, CURRENCY],
    );
    await db.run(
      `INSERT INTO minifig_price_history (fig_number,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,'N',$2,9.00,9.00)`,
      [BL, CURRENCY],
    );

    const v = await priceHistoryMinifig(uid, OWN, CURRENCY);

    assert.ok(v.by_condition?.N, 'No row at all came back for the condition „N", although an acquisition exists');
    assert.equal(
      Number(v.by_condition.N.market_price),
      9,
      `The market price came back as ${v.by_condition.N.market_price} instead of 9. It is stored ` +
        "under the BrickLink number; if only the user's number is queried, " +
        'a „—" remains in the detail window while the finance list shows a value.',
    );
    assert.equal(
      Number(v.by_condition.N.purchase_price),
      4,
      "The purchase price is stored under the user's number and must still be found",
    );
    assert.ok(v.history_new.length >= 1, 'The history is empty — then the chart stays empty although points exist');

    // And the other half: the OWN number must not drop away
    await holdsMinifig(db, uid, WITHOUT_BL, { quantity: 0 }); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
       VALUES ($1,$2,1,3.00,'N')`,
      [uid, WITHOUT_BL],
    );
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,'N',$2,7.00,7.00)
       ON CONFLICT (fig_number,condition,currency_code)
       DO UPDATE SET avg_price=7.00, qty_avg_price=7.00`,
      [WITHOUT_BL, CURRENCY],
    );
    await db.run(
      `INSERT INTO minifig_price_history (fig_number,condition,currency_code,avg_price,qty_avg_price)
       VALUES ($1,'N',$2,7.00,7.00)`,
      [WITHOUT_BL, CURRENCY],
    );

    const w = await priceHistoryMinifig(uid, WITHOUT_BL, CURRENCY);
    assert.ok(w.by_condition?.N, 'Without a BrickLink number no row at all came back');
    assert.equal(
      Number(w.by_condition.N.market_price),
      7,
      `The market price came back as ${w.by_condition.N.market_price} instead of 7. For a ` +
        'figure without its own BrickLink number the prices are stored under its own — ' +
        'that is how the estimate path via the individual parts writes them.',
    );
    assert.ok(w.history_new.length >= 1, 'Without a BrickLink number the history stays empty');
  } finally {
    await db
      .run(`DELETE FROM minifig_price_history WHERE fig_number IN ($1,$2,$3)`, [OWN, BL, WITHOUT_BL])
      .catch(() => {});
    await db
      .run(`DELETE FROM minifig_price_cache   WHERE fig_number IN ($1,$2,$3)`, [OWN, BL, WITHOUT_BL])
      .catch(() => {});
    await db.run(`DELETE FROM minifig_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM minifigs WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
