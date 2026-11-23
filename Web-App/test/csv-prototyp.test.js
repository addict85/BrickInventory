/**
 * A CSV header must not hit the prototype chain — checked on the import's reader
 * (csvReadIn in src/infra/csvExport.ts), not on a copy of its settings.
 *
 * Counter-checks (09.11.2026):
 *   A  in csvReadIn() back to `columns: true` → red: “a column __proto__ …” and “constructor too …”
 *   B  the filter discards every column → red, all three; “ordinary columns stay untouched” names the reason
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { csvReadIn } = require('./helpers/sources').buildAndRequire()('src/infra/csvExport.js');
const readIn = (/** @type {string} */ csv) => csvReadIn(csv).records;

test('a column __proto__ does not end up in the prototype chain', () => {
  const vorher = /** @type {any} */ (Object.prototype).polluted;
  const records = readIn('set_number,__proto__\n10497-1,{"polluted":true}\n');
  assert.equal(records.length, 1);
  assert.equal(records[0].set_number, '10497-1', 'The real column gets lost — the filter reaches too far');
  assert.equal(
    /** @type {any} */ (Object.prototype).polluted,
    vorher,
    'Object.prototype was changed — the header row hit the chain',
  );
  assert.ok(!Object.hasOwn(records[0], '__proto__'), 'The record carries a __proto__ key');
});

test('constructor and prototype are discarded too', () => {
  for (const name of ['constructor', 'prototype']) {
    const r = readIn(`set_number,${name}\n10497-1,x\n`);
    assert.equal(r[0].set_number, '10497-1');
    assert.ok(!Object.hasOwn(r[0], name), `The column "${name}" ended up in the record`);
  }
});

test('ordinary columns stay untouched', () => {
  // A filter that discards EVERYTHING would also pass the two rules above.
  const r = readIn('set_number,quantity,note\n10497-1,2,Geschenk\n');
  assert.deepEqual(
    r.map(z => ({ ...z })),
    [{ set_number: '10497-1', quantity: '2', note: 'Geschenk' }],
  );
});
