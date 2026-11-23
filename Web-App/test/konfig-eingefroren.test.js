/**
 * konfig() reads the environment once and freezes the result; whoever switches it
 * afterwards says so with readConfigNew() or setConfig().
 *
 * Counter-checks (measured 10.11.2026):
 *   A  in konfig() `_konfig ??=` replaced by `_konfig =` (every call rereads)
 *      → red: “after the first read the environment no longer changes anything” (4102 instead of 4101)
 *   B  setConfig() without `...teil` → red: “setConfig puts values on top,
 *      null removes them” (3000 instead of 5)
 *   C  Object.freeze omitted in konfig() → red: “the configuration is frozen”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { config, readConfigNew, setConfig } = _req('src/infra/config.js');

const prior = process.env.PORT;
test.after(() => {
  if (prior === undefined) delete process.env.PORT;
  else process.env.PORT = prior;
  readConfigNew();
});

test('after the first read the environment changes nothing any more', () => {
  process.env.PORT = '4101';
  assert.equal(readConfigNew().port, 4101);
  process.env.PORT = '4102';
  assert.equal(config().port, 4101);
  assert.equal(readConfigNew().port, 4102);
});

test('setConfig lays values over it, null lifts them', () => {
  process.env.PORT = '4103';
  assert.equal(setConfig({ port: 5 }).port, 5);
  assert.equal(config().port, 5);
  assert.equal(setConfig(null).port, 4103);
});

test('the configuration is frozen', () => {
  assert.ok(Object.isFrozen(readConfigNew()));
  assert.ok(Object.isFrozen(setConfig({ port: 5 })));
  setConfig(null);
});
