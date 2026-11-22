/**
 * DELETE the purchase price → refill the market price, on both paths.
 *
 * Counter-check (performed): resolvePrice back to null → the
 * Android substep stays empty, the web app still fills.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (migrations for account_links).
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test('a cleared purchase price is filled from the market price — web app AND app', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `cp-h-${process.pid}`,
    SUB = `cp-s-${process.pid}`;
  const SN = `31146-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);

  // Market prices in the shared cache — two DIFFERENT ones, so that it shows when
  // the wrong condition wins.
  await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]);
  await db.run(
    `INSERT INTO price_cache (set_number,currency_code,condition,avg_price,fetched_at)
                VALUES ($1,'CHF','N',12.55,NOW()),($1,'CHF','U',7.30,NOW())`,
    [SN],
  );
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','CHF')
                ON CONFLICT (key) DO UPDATE SET value='CHF'`);

  const { base, srv } = testServer(_req, { sitzung: { userId: mainId }, t });

  // Starting point: set of the SUB-ACCOUNT with two entries (used + new).
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await holdsSet(db, subId, SN, 0); // Quantity 0: the entry behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity,created_at)
                  VALUES ($1,$2,7.30,'U',1, NOW() - INTERVAL '1 day')`,
      [subId, SN],
    );
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,9.00,'N',1)`,
      [subId, SN],
    );
    return (
      await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 AND condition='N'`, [subId, SN])
    ).id;
  };

  // Marco's finding: Android filled 12.55, the web app 18.90 — for
  // THE SAME operation. The cause was a second, separate price rule in the
  // web app path that read the GLOBAL currency instead of the account's. That is why
  // a deviating global currency with other prices is deliberately set here: …
  await db.run(`INSERT INTO global_settings (key,value) VALUES ('currency','EUR')
                ON CONFLICT (key) DO UPDATE SET value='EUR'`);
  await db.run(
    `INSERT INTO price_cache (set_number,currency_code,condition,avg_price,fetched_at)
                VALUES ($1,'EUR','N',18.90,NOW()),($1,'EUR','U',9.90,NOW())`,
    [SN],
  );
  for (const u of [mainId, subId]) {
    await db.run(
      `INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                  ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`,
      [u],
    );
  }

  try {
    const results = {};
    for (const [name, path] of /** @type {[string, (id: number) => string][]} */ ([
      ['Webapp', id => `/api/v2/sets/${SN}/acquisitions/${id}`],
      ['Android', id => `/api/v2/sets/${SN}/acquisitions/${id}`],
    ])) {
      const id = await aufbauen();
      const r = await fetch(`${base}${path(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purchase_price: '' }), // field cleared
      });
      assert.equal(r.status, 200, `${name}: das Leeren muss angenommen werden`);

      const acq = await db.get(`SELECT purchase_price FROM set_acquisitions WHERE id=$1`, [id]);
      assert.ok(
        acq.purchase_price !== null,
        `${name}: der Kaufpreis blieb LEER — er muss aus dem Marktpreis gefüllt werden`,
      );
      assert.equal(
        Number(acq.purchase_price),
        12.55,
        `${name}: es muss der NEU-Preis sein (12.55), nicht der Gebraucht-Preis der ` + 'Erfassung daneben (7.30)',
      );

      // And the tile at the top — that is where Marco's dash was. Since
      // migration 0032 it computes from the entries; the stock has two here (7.30
      // used, 12.55 new, one copy each), the mean is 9.925.
      const kachel = await _req('src/sets/read.js').conditionAggregate(
        require('./helpers/sources').testContext('sets'),
        [subId],
        SN,
      );
      assert.equal(
        kachel.avg_purchase_price,
        9.925,
        `${name}: die Kachel muss den gefüllten Preis mitrechnen, keinen Strich zeigen`,
      );
      results[name] = Number(acq.purchase_price);
    }

    // The actual promise: BOTH paths reach the same result.
    assert.equal(
      results.Webapp,
      results.Android,
      `Die beiden Clients füllen verschiedene Preise ein (Webapp ${results.Webapp}, ` +
        `Android ${results.Android}) — die Regel existiert dann wieder zweimal`,
    );
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
