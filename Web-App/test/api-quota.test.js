/**
 * Request budget per account under /api/v2 (src/http/apiThrottle.ts).
 *
 * Here the classification and the middleware's answer; the counting itself is in the database
 * and checked across two instances in test/web-two-instances-db.test.js.
 *
 * Counter-checks:
 *   E  COST.preis = 1                        → red: “routes with BrickLink or foreign fetch …”
 *   F  (15.11.2026) einordnung() back to regexes `^…$` on the path → red:
 *      “a trailing slash costs …” (partslist-pdf/ costs 1 instead of 25)
 *   G  (22.11.2026) in apiThrottle() Retry-After left out → red: “the route answers 429 …”;
 *      the store asked without an account → red: “without login the store is not asked”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { classification, apiThrottle, BUDGET, COST } = _req('src/http/apiThrottle.js');

test('catalog fetches cost more than reading', () => {
  assert.equal(classification('GET', '/catalog/sets').kosten, COST.abruf);
  assert.equal(classification('GET', '/sets').kosten, COST.normal);
  assert.equal(classification('POST', '/minifigs/import/csv').auftrag, true);
  assert.equal(classification('GET', '/settings/export/data').auftrag, true);
});

test('a trailing slash costs as much as the route Express finds', () => {
  for (const [m, p, k] of [
    ['POST', '/sets/partslist-pdf/', COST.auftrag],
    ['POST', '/sets/import/csv//', COST.auftrag],
    ['GET', '/wanted/10294-1/prices/', COST.preis],
    ['POST', '/vouchers/3/balance/', COST.abruf],
    ['GET', '/catalog/sets/', COST.abruf],
    ['HEAD', '/settings/export/data/', COST.auftrag],
  ])
    assert.equal(classification(m, p).kosten, k, `${m} ${p}`);
});

test('routes with BrickLink or third-party fetches cost more than reading', () => {
  for (const [m, p] of [
    ['GET', '/wanted/10294-1/prices'],
    ['GET', '/sets/10294-1/price'],
  ])
    assert.equal(classification(m, p).kosten, COST.preis, `${m} ${p}`);
  for (const [m, p] of [
    ['POST', '/sets'],
    ['GET', '/sets/barcode/123'],
    ['POST', '/sets/10294-1/parts'],
    ['POST', '/parts'],
    ['POST', '/minifigs'],
    ['POST', '/vouchers/3/balance'],
  ])
    assert.equal(classification(m, p).kosten, COST.abruf, `${m} ${p}`);
  assert.ok(COST.preis > COST.abruf);
  // The price route must not drain the shared quota with the whole budget.
  const n = Math.floor(BUDGET / COST.preis);
  assert.ok(n * 4 <= 150, `${n} Anfragen je Fenster = bis zu ${n * 4} BrickLink-Aufrufe`);
});

test('the route answers 429 with Retry-After and error code', async t => {
  /** A store whose budget is used up; it counts how often it is asked. */
  const used = { asked: 0 };
  const store = {
    claimApiBudget: async () => {
      used.asked++;
      return { units: BUDGET, jobs: 0, allowed: false, rest_s: '123' };
    },
  };
  const app = express();
  app.use((req, _res, next) => {
    // Object.assign instead of assignment: `session` is not in the type of express.Request.
    Object.assign(req, { session: { userId: 42 } });
    next();
  });
  app.use('/api/v2', apiThrottle(store));
  app.use('/api/v2', (req, res) => res.json({ success: true, path: req.path }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const address = srv.address();
  const base = `http://localhost:${typeof address === 'object' && address ? address.port : 0}/api/v2`;

  const ab = await fetch(base + '/sets');
  assert.equal(ab.status, 429);
  assert.equal((await ab.json()).code, 'too_many_requests');
  assert.equal(ab.headers.get('retry-after'), '123');
  assert.equal(ab.headers.get('ratelimit-remaining'), '0');

  // Without login nothing limits — login has its own brakes.
  const ohne = express();
  ohne.use('/api/v2', apiThrottle(store));
  ohne.use('/api/v2', (_req, res) => res.json({ success: true }));
  const srv2 = ohne.listen(0);
  t.after(() => new Promise(r => srv2.close(r)));
  const address2 = srv2.address();
  const base2 = `http://localhost:${typeof address2 === 'object' && address2 ? address2.port : 0}/api/v2`;
  const vorher = used.asked;
  assert.equal((await fetch(base2 + '/sets')).status, 200);
  assert.equal(used.asked, vorher, 'without login the store is not asked');
});
