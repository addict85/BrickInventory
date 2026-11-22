/**
 * Condition and aggregate of a set against the database: what set-condition-aggregate.test.js
 * used to search for as a pattern in the source text, here on results.
 *
 * Counter-checks (measured 08.11.2026, each reverted):
 *   A  conditionAggregate without max_purchase_price → red “readSet delivers
 *      the same aggregate fields …”
 *   B  changeAcquisition returns the bare response without withSetAggregate →
 *      red “both paths of an entry …” (and the following case, which builds on
 *      its part)
 *   C  POST /api/v2/sets passes `null` instead of the condition to acquireSet → red
 *      “the condition selected in the form arrives on creation”
 *   D  currentMarketPrice: `if (!condition)` → `if (true)` → red “an
 *      explicitly requested condition …” and “the market price as purchase price …”
 *   E  conditionFromAcquisitions always delivers 'N' with acquisitions → red
 *      “readSet …” and “manual parts and minifigures …”
 *   F  sampleAcquisitions sorts by `added_at` → red “the price probe …”;
 *      likewise without `price_cache: cacheRows` in the response
 *   G  priceFor() in setValue.ts always takes the new price → red “gainAndLoss
 *      values by the condition of the entries” (effectiveCondition alone
 *      set to 'N' stays green: with acquisitions their condition applies)
 *   H  (09.11.2026) route and contract of the price probe again as GET → red
 *      “the price probe …” (GET 200 instead of 404)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// The follow-up after capturing otherwise runs after the test against a
// closed pool; acquireSet can be set up for the route.
/** @type {null | ((...a: unknown[]) => Promise<unknown>)} */
let posedAddSet = null;
const Module = require('node:module');
const _realRequire = Module.prototype.require;
Module.prototype.require = function (/** @type {string} */ name, /** @type {any[]} */ ...rest) {
  const m = _realRequire.call(this, name, ...rest);
  if (typeof name === 'string' && /[/\\]addSet(\.js)?$/.test(name))
    return new Proxy(m, {
      // The factory binds at build time (mit()): the replacement only checks the setting when called.
      get: (t, k) => (k === 'acquireSet' ? (sk, ...a) => (posedAddSet ? posedAddSet(...a) : t[k](sk, ...a)) : t[k]),
    });
  return m;
};

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const { catalogSet } = require('./helpers/inventory');

test('condition and aggregate of a set', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const P = process.pid;
  const NAME = `zustand-agg-${P}`;
  const SN = `${80000 + (P % 900)}-1`;
  const PN = `za${P}`;
  const FN = `fig-za${P}`;
  const weg = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM sets WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM rb_sets WHERE set_num = $1', [SN]);
  };
  await weg();
  t.after(async () => {
    await weg().catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1,'x',true) RETURNING id`, [NAME])
  ).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);
  for (const [z, preis] of [
    ['N', 55],
    ['U', 33],
  ])
    await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`, [
      SN,
      z,
      preis,
    ]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  const erste = (
    await db.get(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                               VALUES ($1,$2,2,100,'N','CHF', NOW() - INTERVAL '10 days') RETURNING id`,
      [uid, SN],
    )
  ).id;

  await adminWithFactor(_req, uid);
  const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, t });
  const anfrage = async (
    /** @type {string} */ methode,
    /** @type {string} */ path,
    /** @type {unknown} */ rumpf = undefined,
  ) => {
    const r = await fetch(base + '/api/v2' + path, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: rumpf === undefined ? undefined : JSON.stringify(rumpf),
    });
    return { status: r.status, body: await r.json() };
  };
  const { readSets, readSet } = require('./helpers/sources').areaPage('sets');

  await t.test('an explicitly requested condition beats the entry valuation', async () => {
    const { currentMarketPrice } = _req('src/finances/marketPrice.js');
    assert.equal(await currentMarketPrice(SN, uid), 55, 'without a request: according to the (new) acquisitions');
    assert.equal(
      await currentMarketPrice(SN, uid, 'U'),
      33,
      'The requested condition was overruled by the valuation of the acquisitions',
    );
  });

  await t.test('the market price as purchase price depends on the selected condition', async () => {
    const { acquireSet, setSupplement } = require('./helpers/sources').areaPage('sets');
    const r = await acquireSet({
      requester: uid,
      setNumber: SN,
      quantity: 1,
      condition: 'U',
      ifPresent: 'aufstocken',
    });
    assert.equal(r.action, 'updated', 'setup: the top-up path without catalogue and network');
    // The follow-up work fills in the estimated price; with a catalog it asks no network.
    await catalogSet(db, SN, { name: 'Zustand', image_local: `/images/sets/${SN}.jpg` });
    await setSupplement(SN, uid);
    const neu = await db.get(
      `SELECT condition, purchase_price::float AS preis FROM set_acquisitions
        WHERE user_id = $1 AND set_number = $2 AND id <> $3`,
      [uid, SN, erste],
    );
    assert.deepEqual(neu, { condition: 'U', preis: 33 }, 'recorded as used, but the new price entered');
  });

  await t.test('readSet delivers the same aggregate fields as readSets', async () => {
    const liste = (await readSets([uid], {})).sets.find((/** @type {any} */ s) => s.set_number === SN);
    const einzeln = await readSet([uid], SN);
    assert.ok(liste && einzeln, 'The set is missing in one of the two responses');
    for (const field of ['condition', 'acq_count', 'used_count', 'max_purchase_price']) {
      assert.ok(einzeln[field] !== undefined && einzeln[field] !== null, `readSet() without ${field}`);
      assert.equal(
        String(einzeln[field]),
        String(liste[field]),
        `${field}: readSet ${einzeln[field]}, readSets ${liste[field]}`,
      );
    }
    assert.equal(einzeln.condition, 'U', 'a used acquisition makes the set used');
    assert.equal(Number(einzeln.used_count), 1);
  });

  await t.test('both paths of an entry deliver the aggregate — only for sets', async () => {
    const changed = await anfrage('PUT', `/sets/${SN}/acquisitions/${erste}`, { condition: 'U' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.set?.set_number, SN, 'The response to the change carries no set aggregate');
    assert.equal(changed.body.set.acq_count, 2);
    assert.equal(changed.body.set.used_count, 2);
    const deleted = await anfrage('DELETE', `/sets/${SN}/acquisitions/${erste}`);
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.set?.acq_count, 1, 'The response to the deletion carries no current aggregate');

    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,5,'manual')`, [uid, PN]);
    const tid = (
      await db.get(
        `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition)
                               VALUES ($1,$2,5,1,1,'N') RETURNING id`,
        [uid, PN],
      )
    ).id;
    const teil = await anfrage('PUT', `/parts/${PN}/5/acquisitions/${tid}`, { quantity: 2 });
    assert.equal(teil.status, 200, JSON.stringify(teil.body));
    assert.equal(teil.body.set, undefined, 'A part has no set aggregate');
  });

  await t.test('manual parts and minifigures use the same condition rule as sets', async () => {
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition)
                  VALUES ($1,$2,5,1,1,'U')`,
      [uid, PN],
    );
    await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FN]);
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition)
                  VALUES ($1,$2,1,1,'N'), ($1,$2,1,1,'U')`,
      [uid, FN],
    );
    const { manualPartsList } = _req('src/parts/queries.js');
    const { readManualMinifigs } = _req('src/minifigs/queries.js');
    const teil = (await manualPartsList([uid], uid, {})).find((/** @type {any} */ p) => p.part_number === PN);
    const figur = (await readManualMinifigs([uid], uid, {})).find((/** @type {any} */ f) => f.fig_number === FN);
    assert.equal(teil?.condition, 'U', 'part with a used acquisition shows as new');
    assert.equal(figur?.condition, 'U', 'figure with a used acquisition shows as new');
  });

  await t.test('gainAndLoss values by the condition of the entries', async () => {
    const { gainAndLoss } = _req('src/finances/financeCalc.js');
    const pnl = await gainAndLoss(uid, [uid]);
    const row = pnl.sets.find((/** @type {any} */ s) => s.set_number === SN);
    assert.ok(row, 'The set is missing in the profit-and-loss statement');
    assert.equal(Number(row.current_price), 33, `A set recorded as used gets the new price: ${JSON.stringify(row)}`);
  });

  await t.test('the price probe runs without a server error', async () => {
    // Via GET a link of a foreign site (lax cookie) already triggered the fetch.
    const perLink = await fetch(`${base}/api/v2/admin/price-probe?set=${SN}&live=1`);
    assert.equal(perLink.status, 404, 'the probe can be triggered via GET');
    const r = await anfrage('POST', '/admin/price-probe', { set: SN });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.condition_logic?.chosen_for_price, 'U', 'The probe does not show the rule of the valuation');
    assert.deepEqual(
      r.body.price_cache.map((/** @type {any} */ z) => z.condition).sort(),
      ['N', 'U'],
      "The set's cache rows belong in the response",
    );
  });

  await t.test('the condition selected in the form arrives on creation', async () => {
    /** @type {any[][]} */
    const aufrufe = [];
    posedAddSet = async (...a) => {
      aufrufe.push(a);
      return {
        action: 'added',
        set_number: /** @type {any} */ (a[0]).setNumber,
        name: 'Testset',
        catalog_pending: true,
        supplement: 'pending',
        besitzer: uid,
      };
    };
    try {
      const r = await anfrage('POST', '/sets', {
        set_number: `${90000 + (P % 900)}-1`,
        purchase_price: 20,
        condition: 'u',
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    } finally {
      posedAddSet = null;
    }
    assert.equal(aufrufe.length, 1, 'acquireSet was not called');
    assert.equal(aufrufe[0][0].kaufpreis, 20, 'The purchase price does not arrive');
    assert.equal(aufrufe[0][0].condition, 'U', 'The condition from the form does not arrive at acquireSet');
  });
});
