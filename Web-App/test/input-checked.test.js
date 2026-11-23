/**
 * The route gets body and query as the contract checked them
 * (req.eingabe, req.abfrage from checkInput): converted, without unknown
 * fields. Inputs and queries are closed; an unknown field is 400
 * with the code field_unknown. The query stands in docs/openapi.json.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  in checkInput `geprueft.eingabe = r.data` deleted → red: “the
 *      route sees the converted body”
 *   B  in checkInput `geprueft.abfrage = req.query` instead of the result
 *      → red: “the route sees the converted query”
 *   C  NewSet (contract/sets.ts) as z.looseObject → red: “an unknown field
 *      is 400” and “every input and query is closed”
 *   D  in reportDeviation the branch unrecognized_keys deleted → red: “an
 *      unknown field is 400” and “a wrong query is 400” (code
 *      input_invalid)
 *   E  in openapi.ts the query parameters as `in: 'header'` → red: “the
 *      query stands in the OpenAPI description”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const _req = require('./helpers/sources').buildAndRequire();
const { portOf } = require('./helpers/server');
const { contractRouter: contractRouterFn } = _req('src/http/contractRouter.js');
const { CONTRACT } = _req('src/contract/index.js');

test('checked input and query', { concurrency: 1 }, async t => {
  let aufrufe = 0;
  const router = contractRouterFn('/api/v2');
  // Past res.json: the response check (test mode) applies to the real body.
  const zeige = (req, res) => {
    aufrufe++;
    res.type('json').send(JSON.stringify({ input: req.input, query: req.queryArgs }));
  };
  router.endpoint('POST /api/v2/sets', zeige);
  router.endpoint('GET /api/v2/catalog/sets', zeige);
  const app = express();
  app.use(express.json());
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', router);
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://localhost:${portOf(srv)}/api/v2`;
  const sende = async (path, rumpf) => {
    const r = await fetch(
      basis + path,
      rumpf === undefined
        ? {}
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rumpf) },
    );
    return { status: r.status, body: await r.json() };
  };

  await t.test('the route sees the converted body', async () => {
    const r = await sende('/sets', { set_number: '10179-1', quantity: '3', purchase_price: '12,50', condition: 'U' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.input, { set_number: '10179-1', quantity: 3, purchase_price: 12.5, condition: 'U' });
  });

  await t.test('an unknown field is 400', async () => {
    const vorher = aufrufe;
    const r = await sende('/sets', { set_number: '10179-1', purchasePrice: 12 });
    assert.deepEqual([r.status, r.body.code], [400, 'field_unknown']);
    assert.match(r.body.error, /purchasePrice/);
    assert.equal(aufrufe, vorher, 'the route ran anyway');
  });

  await t.test('the route sees the converted query', async () => {
    const r = await sende('/catalog/sets?page=2&theme_id=&q=Haus');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.query, { page: 2, theme_id: null, q: 'Haus' });
  });

  await t.test('a wrong query is 400', async () => {
    const vorher = aufrufe;
    const zahl = await sende('/catalog/sets?page=zwei');
    assert.deepEqual([zahl.status, zahl.body.code], [400, 'input_invalid']);
    assert.match(zahl.body.error, /page/);
    const fremd = await sende('/catalog/sets?seite=2');
    assert.deepEqual([fremd.status, fremd.body.code], [400, 'field_unknown']);
    assert.equal(aufrufe, vorher);
  });
});

test('every input and query is closed', () => {
  // Exceptions: key-value lists whose keys the route checks itself.
  const OPEN = ['PUT /api/v2/settings'];
  const open = [];
  for (const [k, r] of Object.entries(CONTRACT)) {
    for (const s of [r.input, r.query].filter(Boolean)) {
      const def = s._zod.def;
      if (def.type === 'object' ? def.catchall?._zod.def.type !== 'never' : !OPEN.includes(k)) open.push(k);
    }
  }
  assert.deepEqual(open, []);
  assert.ok(Object.values(CONTRACT).filter(r => r.query).length >= 40, 'too few routes with a query');
});

test('the query is in the OpenAPI description', () => {
  const dok = _req('src/contract/openapi.js').openapi(2);
  const abfrage = dok.paths['/api/v2/sets'].get.parameters.filter(p => p.in === 'query');
  assert.deepEqual(abfrage.map(p => p.name).sort(), [
    'accounts',
    'page',
    'page_size',
    'search',
    'sort',
    'storage',
    'theme',
  ]);
  assert.equal(abfrage.find(p => p.name === 'page').schema.type, 'string');
  const alle = Object.values(dok.paths)
    .flatMap(o => Object.values(o))
    .flatMap(op => op.parameters ?? [])
    .filter(p => p.in === 'query');
  assert.ok(alle.length >= 80, `only ${alle.length} query parameters in the OpenAPI description`);
});
