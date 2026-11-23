/**
 * Cache (src/infra/cache.ts): bounded, with a deadline per
 * entry; compartments belong to the factory of a scope, not to the process.
 *
 * Counter-checks (measured 11.11.2026, each alone):
 *   A  setze() evicts the newest instead of the oldest entry
 *      (`[...keys()].pop()`) → red: “the oldest gives way”
 *   B  hole() does not check the deadline → red: “forgotten after the deadline”
 *   C  Faecher.domain() creates anew on every call → red: “a compartment stays”
 *   D  createCatalog gives all factories the same compartments (module-wide
 *      `const FAECHER = new Faecher()`) → red: “own compartments per factory”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { Cache: Zwischenspeicher, Compartments: Faecher } = _req('src/infra/cache.js');
const { createCatalog } = _req('src/catalog/area.js');

test('the oldest gives way when the store is full', () => {
  const z = new Zwischenspeicher(2);
  z.set('a', 1);
  z.set('b', 2);
  z.set('c', 3);
  assert.equal(z.hole('a'), undefined);
  assert.equal(z.hole('b'), 2);
  assert.equal(z.hole('c'), 3);
  assert.equal(z.size, 2);
});

test('forgotten after the deadline, an own deadline only applies to its entry', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const z = new Zwischenspeicher(10, 60_000);
  z.set('lang', true);
  z.set('kurz', false, 1_000);
  t.mock.timers.tick(5_000);
  assert.equal(z.hole('kurz'), undefined);
  assert.equal(z.hole('lang'), true);
  t.mock.timers.tick(60_000);
  assert.equal(z.hole('lang'), undefined);
});

test('a compartment stays, own compartments per factory', () => {
  const f = new Faecher();
  const a = f.slot('x', () => new Zwischenspeicher(1));
  assert.equal(
    f.slot('x', () => new Zwischenspeicher(1)),
    a,
  );
  /** @type {any[]} */
  const k = [];
  // When built, the catalog listens for the images (atSetImageLoaded); the build needs nothing more.
  const abh = /** @type {any} */ ({ db: {}, bilder: { atSetImageLoaded() {} } });
  createCatalog(abh, x => k.push(x));
  createCatalog(abh, x => k.push(x));
  const [k1, k2] = k;
  k1.compartments.slot('themenbaum', () => ({ n: 1 })).n = 2;
  assert.equal(k2.compartments.slot('themenbaum', () => ({ n: 1 })).n, 1);
});
