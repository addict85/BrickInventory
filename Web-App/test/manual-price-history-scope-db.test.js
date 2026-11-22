/**
 * Price history in the household — set, manual part AND manual minifigure.
 *
 * Counter-check (carried out): scopeIds() in the two minifigure routes
 * back to `uid` → both minifigure substeps turn red, set and part
 * stay green.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (migrations for account_links).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

test("price history: the main account sees the sub-account's acquisitions", { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `ph-haupt-${process.pid}`,
    SUB = `ph-sub-${process.pid}`;
  const SN = `98001-${process.pid}`;
  const PN = `ph-part-${process.pid}`;
  const FN = `ph-fig-${process.pid}`;
  const CUR = 'EUR';

  const aufraeumen = async () => {
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(`DELETE FROM part_acquisitions WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(`DELETE FROM part_price_cache WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(`DELETE FROM minifigs WHERE fig_number=$1`, [FN]).catch(() => {});
    await db.run(`DELETE FROM minifig_acquisitions WHERE fig_number=$1`, [FN]).catch(() => {});
    await db.run(`DELETE FROM minifig_price_cache WHERE fig_number=$1`, [FN]).catch(() => {});
    await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);
  // Both accounts on the same currency — otherwise the history reads a different
  // cache key than the seed writes.
  for (const id of [mainId, subId])
    await db.run(
      `INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency',$2)
                  ON CONFLICT (user_id,key) DO UPDATE SET value=$2`,
      [id, CUR],
    );

  await aufraeumen();

  // ── CREATE stock, and that consistently with the SUB-ACCOUNT ────────────────
  await holdsSet(db, subId, SN, 0); // quantity 0: the acquisition behind it carries it
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,10,'N',1)`,
    [subId, SN],
  );
  await db.run(
    `INSERT INTO price_cache (set_number,condition,currency_code,avg_price,total_quantity)
                VALUES ($1,'N',$2,20,1)`,
    [SN, CUR],
  );

  await holdsPart(db, subId, PN, { quantity: 0, colorId: 4 }); // quantity 0: the acquisition behind it carries it
  await db.run(
    `INSERT INTO part_acquisitions (user_id,part_number,color_id,unit_price,condition,quantity)
                VALUES ($1,$2,4,3,'N',1)`,
    [subId, PN],
  );
  await db.run(
    `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price)
                VALUES ($1,4,'N',$2,6)`,
    [PN, CUR],
  );

  await holdsMinifig(db, subId, FN, { quantity: 0 }); // quantity 0: the acquisition behind it carries it
  await db.run(
    `INSERT INTO minifig_acquisitions (user_id,fig_number,unit_price,condition,quantity)
                VALUES ($1,$2,4,'N',1)`,
    [subId, FN],
  );
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number,condition,currency_code,avg_price)
                VALUES ($1,'N',$2,8)`,
    [FN, CUR],
  );

  const appFor = userId => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { userId };
      req.apiUser = { user_id: userId, is_admin: 0 };
      next();
    });
    app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
    app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
    return app;
  };
  const srv = appFor(mainId).listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Since stage 5 there is only ONE address per kind; both clients call
  // it (requireToken takes session or token). What is checked here is the
  // rule, not the credential — the equivalence of the credentials stands in
  // api-parity.
  const CASES = [
    ['Set', `/api/v2/sets/${SN}/price-history`],
    ['Teil', `/api/v2/parts/${PN}/4/price-history`],
    ['Minifigur', `/api/v2/minifigs/${FN}/price-history`],
  ];

  try {
    for (const [kind, path] of CASES) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200, `${kind}: ${path} -> ${r.status}`);
      const b = await r.json();
      const n = b.by_condition?.N;
      assert.ok(
        n,
        `${kind}: keine Zeile für „Neu" — die Erfassung des Unterkontos ` +
          'wurde nicht gefunden (fehlendes Blickfeld)',
      );
      assert.ok(n.purchase_price > 0, `${kind}: der Kaufpreis des Unterkontos fehlt`);
      assert.ok(n.pnl_pct != null, `${kind}: ohne Kaufpreis gibt es auch keine Prozentangabe`);
    }

    // Opposite direction: with accounts=own the main account explicitly looks only
    // at ITSELF — then the row must NOT appear. Without this check the
    // test would also be green if somebody replaced the scope by „all accounts of the
    // installation\".
    for (const [kind, path] of CASES) {
      const r = await fetch(`${base}${path}?accounts=own`);
      const b = await r.json();
      assert.equal(
        b.by_condition?.N,
        undefined,
        `${kind}: mit accounts=own darf die Erfassung des Unterkontos nicht mitzählen`,
      );
    }
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM account_links WHERE main_user_id=$1`, [mainId]).catch(() => {});
    await db.run(`DELETE FROM user_settings WHERE user_id IN ($1,$2)`, [mainId, subId]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
