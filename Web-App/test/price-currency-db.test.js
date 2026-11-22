/**
 * Market price of the detail view: the SERVER determines the currency, not the
 * client — against the real route and table.
 *
 * Counter-check (carried out): `req.query.currency ||` prepended again →
 * the first substep here turns red (no_price instead of 629.90).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test("the app's currency parameter does NOT override the user setting", { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const USERNAME = 'currency-param-test';
  const SET = '10307-1';
  await db.run(`DELETE FROM users WHERE username=$1`, [USERNAME]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin,is_active) VALUES ($1,'x',false,true)`, [USERNAME]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USERNAME])).id;
  await db.run(
    `INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`,
    [uid],
  );
  await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]);
  await holdsSet(db, uid, SET, 1);
  // The price exists ONLY in the configured currency — as in operation, where the
  // price job fills exactly that one.
  await db.run(
    `INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
                VALUES ($1,'N','CHF',500,629.90,800,631,7,NOW())
                ON CONFLICT (set_number,condition,currency_code)
                DO UPDATE SET avg_price=629.90, fetched_at=NOW()`,
    [SET],
  );

  const { base, srv } = testServer(_req, { sitzung: { userId: uid, username: USERNAME, isAdmin: false }, t });

  const hole = async query => {
    const r = await fetch(`${base}/api/v2/sets/${SET}/price${query}`);
    assert.equal(r.status, 200);
    return r.json();
  };

  try {
    // The error case from before: the app sends its start value EUR along. The
    // response must nevertheless be the CHF price of the user setting.
    let j = await hole('?currency=EUR');
    assert.equal(j.currency, 'CHF', "the response currency is the user's setting, not the parameter");
    assert.equal(parseFloat(j.avg_price), 629.9, "the price comes from the cache of the user's setting");
    assert.ok(!j.no_price, 'no no_price — exactly that was the empty tile');

    // Without a parameter (web app, future app versions): identical result.
    j = await hole('');
    assert.equal(j.currency, 'CHF');
    assert.equal(parseFloat(j.avg_price), 629.9);
  } finally {
    await db.run(`DELETE FROM users WHERE username=$1`, [USERNAME]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SET]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SET]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
