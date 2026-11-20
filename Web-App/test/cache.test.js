/**
 * Zwischenspeicher (src/infra/cache.ts): begrenzt, mit Frist je
 * Eintrag; Fächer gehören zur Fabrik eines Bereichs, nicht zum Prozess.
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   A  setze() verdrängt den jüngsten statt des ältesten Eintrags
 *      (`[...keys()].pop()`) → rot: „der älteste weicht“
 *   B  hole() prüft die Frist nicht → rot: „nach der Frist vergessen“
 *   C  Faecher.fach() legt bei jedem Aufruf neu an → rot: „ein Fach bleibt“
 *   D  createCatalog gibt allen Fabriken dieselben Fächer (modulweites
 *      `const FAECHER = new Faecher()`) → rot: „je Fabrik eigene Fächer“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { Zwischenspeicher, Faecher } = _req('src/infra/cache.js');
const { createCatalog } = _req('src/catalog/area.js');

test('the oldest gives way when the store is full', () => {
  const z = new Zwischenspeicher(2);
  z.setze('a', 1);
  z.setze('b', 2);
  z.setze('c', 3);
  assert.equal(z.hole('a'), undefined);
  assert.equal(z.hole('b'), 2);
  assert.equal(z.hole('c'), 3);
  assert.equal(z.groesse, 2);
});

test('forgotten after the deadline, an own deadline only applies to its entry', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const z = new Zwischenspeicher(10, 60_000);
  z.setze('lang', true);
  z.setze('kurz', false, 1_000);
  t.mock.timers.tick(5_000);
  assert.equal(z.hole('kurz'), undefined);
  assert.equal(z.hole('lang'), true);
  t.mock.timers.tick(60_000);
  assert.equal(z.hole('lang'), undefined);
});

test('a compartment stays, own compartments per factory', () => {
  const f = new Faecher();
  const a = f.fach('x', () => new Zwischenspeicher(1));
  assert.equal(
    f.fach('x', () => new Zwischenspeicher(1)),
    a,
  );
  /** @type {any[]} */
  const k = [];
  // Der Katalog horcht beim Bau auf die Bilder (atSetImageLoaded); mehr braucht der Bau nicht.
  const abh = /** @type {any} */ ({ db: {}, bilder: { atSetImageLoaded() {} } });
  createCatalog(abh, x => k.push(x));
  createCatalog(abh, x => k.push(x));
  const [k1, k2] = k;
  k1.faecher.fach('themenbaum', () => ({ n: 1 })).n = 2;
  assert.equal(k2.faecher.fach('themenbaum', () => ({ n: 1 })).n, 1);
});
