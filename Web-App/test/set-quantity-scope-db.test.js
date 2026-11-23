/**
 * Changing the quantity of a SUB-ACCOUNT set — both route families.
 *
 * Counter-check (carried out): schreibbereich in changeSet back to the own ID
 * → both substeps end in 404 again.
 * Counter-check (measured 09.11.2026): the session branch removed in requireToken →
 * red: „Webapp: … 401 !== 200“. The app path comes without a session, with a real token;
 * a wrong token results in 401 (own assertion before the loop).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (migrations for account_links).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { holdsSet, quantityOf } = require('./helpers/inventory');

test('a quantity increase on the sub-account set lands in the own account', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `qty-haupt-${process.pid}`,
    SUB = `qty-sub-${process.pid}`;
  const SN = `31142-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);

  // The web app comes with the session, the app with a real token and without a session.
  const web = testServer(_req, { session: { userId: mainId }, t });
  const app = testServer(_req, { session: {}, t });
  const token = await _req('src/account/deviceToken.js').createToken(mainId, 'test-app', false, null, {
    scope: 'app',
  });
  const srv = web.srv;

  const setUp = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    // Set AND acquisition belong to the sub-account.
    // Market price in the cache: the new acquisition should get IT and not the
    // purchase price of the other account — its purchase is not mine.
    await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                  ON CONFLICT (key) DO UPDATE SET value='EUR'`);
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]);
    await db.run(
      `INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                  VALUES ($1,'U','EUR',77.00,77.00,4)`,
      [SN],
    );
    // Only the inventory row: quantity, price and condition stand in the acquisition
    // below (migration 0032 for price and condition, 0036 for the quantity).
    await holdsSet(db, subId, SN, 0);
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,108.00,'U',1)`,
      [subId, SN],
    );
  };

  try {
    const without = await fetch(`${app.base}/api/v2/sets/${SN}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: 3 }),
    });
    assert.equal(without.status, 401, 'the app path must not get through without a token');
    /** @type {[string, string, Record<string, string>][]} */
    const pathList = [
      ['Webapp', web.base, {}],
      ['Android', app.base, { authorization: `Bearer ${token}` }],
    ];
    for (const [name, base, credential] of pathList) {
      await setUp();
      const r = await fetch(`${base}/api/v2/sets/${SN}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...credential },
        body: JSON.stringify({ quantity: 3 }),
      });
      assert.equal(r.status, 200, `${name}: the quantity change must no longer end in 404`);

      // (The quantities now all come from the acquisitions — migration 0036.)
      // ── Marco's new rule ────────────────────────────────
      // „Die Anzahl soll immer von allen angezeigt werden. Wenn ich diese
      // erhöhe, soll es für meinen Account einen neuen Kaufpreis-Eintrag …
      const onOwner = await quantityOf(db, subId, SN);
      assert.equal(onOwner, 1, `${name}: the sub-account's stock must not change because of a foreign increase`);

      const onViewer = await quantityOf(db, mainId, SN);
      assert.equal(onViewer, 2, `${name}: the difference (3 − 1) must be in the own account`);

      const total = await quantityOf(db, [subId, mainId], SN);
      assert.equal(total, 3, `${name}: the total quantity must match the input`);

      // And the acquisitions follow — in the own account, with a price.
      const acq = await db.get(
        `SELECT COALESCE(SUM(quantity),0)::int AS q,
                COUNT(*) FILTER (WHERE purchase_price IS NOT NULL)::int AS with_price
           FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`,
        [mainId, SN],
      );
      assert.equal(acq.q, 2, `${name}: the acquisition quantity of the own account must follow`);
      assert.ok(
        acq.with_price > 0,
        `${name}: the new acquisition needs a purchase price — otherwise it is missing in every total`,
      );
      const price = await db.get(
        `SELECT purchase_price FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
          ORDER BY id DESC LIMIT 1`,
        [mainId, SN],
      );
      assert.equal(
        Number(price.purchase_price),
        77,
        `${name}: it must be the MARKET PRICE (77), not the purchase price of the other account (108)`,
      );
    }
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
