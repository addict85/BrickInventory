/**
 * Strict response check in tests: a field the contract does not name is
 * reported, also in open objects (looseObject), lists, unions and
 * extensions; a record() describes arbitrary keys and reports none.
 * The second part checks the wiring in vertragsRouter on the real router.
 *
 * Counter-checks (measured on 11.11.2026):
 *   A  in unknownFields() `else if (offen) funde.add(…)` removed → red:
 *      “a foreign field, also nested in lists”
 *   B  in the branch 'union' the first option taken instead of the matching one → red:
 *      “in a union the option that matches counts”
 *   C  in responseAgainstContract() the line `if (fremd.length) fehler.push(…)`
 *      removed → red: “the route answers 500 if a field is missing in the contract”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const _req = require('./helpers/sources').buildAndRequire();
const { unknownFields } = _req('src/contract/unknownFields.js');

test('a foreign field, also nested in lists', () => {
  const Row = z.looseObject({ id: z.number(), name: z.string().nullable().optional() });
  const Reply = z.looseObject({ success: z.boolean(), sets: z.array(Row) });
  const value = {
    success: true,
    extra: 1,
    sets: [
      { id: 1, name: null },
      { id: 2, secret: 'x' },
    ],
  };
  assert.deepEqual(unknownFields(Reply, value), ['extra', 'sets.1.secret']);
  assert.deepEqual(unknownFields(Reply, { success: true, sets: [{ id: 1 }] }), []);
});

test('extensions, envelopes and records', () => {
  const Basis = z.looseObject({ a: z.number() });
  const More = Basis.extend({ b: z.string().optional() });
  assert.deepEqual(unknownFields(More.nullable().optional(), { a: 1, b: 'x', c: 2 }), ['c']);
  const JobMap = z.looseObject({ jobs: z.record(z.string(), z.looseObject({ n: z.number() })) });
  assert.deepEqual(unknownFields(JobMap, { jobs: { prices: { n: 1, lauf: 2 }, images: { n: 2 } } }), [
    'jobs.prices.lauf',
  ]);
});

test('in a union the option that fits counts', () => {
  const A = z.looseObject({ kind: z.literal('a'), x: z.number() });
  const B = z.looseObject({ kind: z.literal('b'), y: z.number() });
  assert.deepEqual(unknownFields(z.union([A, B]), { kind: 'b', y: 1 }), []);
  assert.deepEqual(unknownFields(z.union([A, B]), { kind: 'b', y: 1, z: 0 }), ['z']);
});

test('the route answers 500 if a field is missing in the contract', async () => {
  const { checkContract } = _req('src/http/contractRouter.js');
  const checker = checkContract();
  assert.ok(checker, 'CHECK_CONTRACT is set in tests');
  // GET /api/v2/sets/info/:setNumber: SetInfoResponse names no field `geheim`.
  const req = { method: 'GET', baseUrl: '/api/v2', route: { path: '/sets/info/:setNumber' }, body: {} };
  let status = 200;
  let sent;
  const res = {
    statusCode: 200,
    locals: {},
    status(s) {
      status = s;
      this.statusCode = s;
      return this;
    },
    json(r) {
      sent = r;
      return this;
    },
  };
  checker(req, res, () => {});
  res.json({ success: true, set_number: '1-1', name: 'x', in_catalog: true, secret: 1 });
  assert.equal(status, 500);
  assert.match(String(sent.deviations), /nicht im Vertrag: secret/);

  const res2 = {
    ...res,
    statusCode: 200,
    locals: {},
    json(r) {
      sent = r;
      return this;
    },
  };
  status = 200;
  checker(req, res2, () => {});
  res2.json({ success: true, set_number: '1-1', name: 'x', in_catalog: true });
  assert.equal(status, 200);
});
