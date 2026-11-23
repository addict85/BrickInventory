/**
 * Deleting a set of a SUB-ACCOUNT — both paths, both directions.
 *
 * Read wide, write narrow: a main account deletes sets of its sub-accounts,
 * but a sub-account no set of the main account. Both deletion paths run in
 * one transaction so that no part remains without a set.
 *
 * Counter-check (carried out): schreibbereich in both routes back to the
 * own ID → the first substep ends in 404 again.
 * Counter-check (measured 09.11.2026): the session branch removed in requireToken →
 * red: „Webapp: … 401 !== 200“. The app path comes without a session, with a real token;
 * a wrong token results in 401 (own assertion before the loop).
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
const { holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('deleting in the household: forward allowed, backward not', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `del-haupt-${process.pid}`,
    SUB = `del-sub-${process.pid}`;
  const SN = `99001-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);

  // The web app comes with the session, the app with a real token and without a session.
  const { createToken } = _req('src/account/deviceToken.js');
  const token = {
    [mainId]: await createToken(mainId, 'test-app', false, null, { scope: 'app' }),
    [subId]: await createToken(subId, 'test-app', false, null, { scope: 'app' }),
  };
  const appFor = userId => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = req.headers.authorization ? {} : { userId };
      next();
    });
    app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
    app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
    return app;
  };
  const srvMain = appFor(mainId).listen(0);
  const srvSub = appFor(subId).listen(0);
  const baseMain = `http://localhost:${srvMain.address().port}`;
  const baseSub = `http://localhost:${srvSub.address().port}`;

  // Create a set with content — the owner is chosen per case.
  const create = async owner => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM parts WHERE set_number=$1`, [SN]);
    await holdsSet(db, owner, SN, 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`,
      [owner, SN],
    );
    await holdsPart(db, owner, '3001', { setNumber: SN, quantity: 5, colorId: 4 });
  };
  const holding = async owner => ({
    set: !!(await db.get(`SELECT 1 FROM sets WHERE user_id=$1 AND set_number=$2`, [owner, SN])),
    parts: (await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND set_number=$2`, [owner, SN])).c,
    acq: (await db.get(`SELECT COUNT(*)::int c FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [owner, SN]))
      .c,
  });

  try {
    // 1. FORWARD: the main account deletes a set of the sub-account — and completely.
    // Without token and without session no access: the app path really checks the token.
    const without = await fetch(`${baseMain}/api/v2/sets/${SN}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer falsch' },
    });
    assert.equal(without.status, 401, 'the app path must not go through the session');
    // One address, two credentials: session (web app) and token (app).
    const credential = (name, uid) => (name === 'Android' ? { authorization: `Bearer ${token[uid]}` } : {});
    for (const [name, base, path] of [
      ['Webapp', baseMain, `/api/v2/sets/${SN}`],
      ['Android', baseMain, `/api/v2/sets/${SN}`],
    ]) {
      await create(subId);
      const r = await fetch(`${base}${path}`, { method: 'DELETE', headers: credential(name, mainId) });
      assert.equal(r.status, 200, `${name}: deleting must no longer end in 404`);
      const b = await holding(subId);
      assert.equal(b.set, false, `${name}: the set must be gone`);
      assert.equal(b.parts, 0, `${name}: the parts must not stay behind as orphans`);
      assert.equal(
        b.acq,
        0,
        `${name}: the purchase price acquisitions must go too — otherwise they reappear when ` +
          'the same set is added again',
      );
    }

    // 2. BACKWARD: the sub-account must NOT delete a set of the MAIN account.
    //    Exactly for that schreibbereich() stands there and not scopeIds().
    for (const [name, path] of [
      ['Webapp', `/api/v2/sets/${SN}`],
      ['Android', `/api/v2/sets/${SN}`],
    ]) {
      await create(mainId);
      const r = await fetch(`${baseSub}${path}`, { method: 'DELETE', headers: credential(name, subId) });
      assert.equal(r.status, 404, `${name}: a sub-account must not delete backwards`);
      const b = await holding(mainId);
      assert.equal(b.set, true, `${name}: the main account's set must stay untouched`);
      assert.equal(b.parts, 1, `${name}: the parts stay too`);
    }
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE set_number=$1`, [SN]).catch(() => {});
    await new Promise(r => srvMain.close(r));
    await new Promise(r => srvSub.close(r));
    await db.pool.end().catch(() => {});
  }
});
