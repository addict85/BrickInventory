/**
 * Zwischenspeicher (src/infra/zwischenspeicher.ts): begrenzt, mit Frist je
 * Eintrag; Fächer gehören zur Fabrik eines Bereichs, nicht zum Prozess.
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   A  setze() verdrängt den jüngsten statt des ältesten Eintrags
 *      (`[...keys()].pop()`) → rot: „der älteste weicht“
 *   B  hole() prüft die Frist nicht → rot: „nach der Frist vergessen“
 *   C  Faecher.fach() legt bei jedem Aufruf neu an → rot: „ein Fach bleibt“
 *   D  erzeugeKatalog gibt allen Fabriken dieselben Fächer (modulweites
 *      `const FAECHER = new Faecher()`) → rot: „je Fabrik eigene Fächer“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { Zwischenspeicher, Faecher } = _req('src/infra/zwischenspeicher.js');
const { erzeugeKatalog } = _req('src/katalog/bereich.js');

test('der älteste weicht, wenn der Speicher voll ist', () => {
  const z = new Zwischenspeicher(2);
  z.setze('a', 1);
  z.setze('b', 2);
  z.setze('c', 3);
  assert.equal(z.hole('a'), undefined);
  assert.equal(z.hole('b'), 2);
  assert.equal(z.hole('c'), 3);
  assert.equal(z.groesse, 2);
});

test('nach der Frist vergessen, eine eigene Frist gilt nur für ihren Eintrag', t => {
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

test('ein Fach bleibt, je Fabrik eigene Fächer', () => {
  const f = new Faecher();
  const a = f.fach('x', () => new Zwischenspeicher(1));
  assert.equal(
    f.fach('x', () => new Zwischenspeicher(1)),
    a,
  );
  /** @type {any[]} */
  const k = [];
  erzeugeKatalog({ db: /** @type {any} */ ({}) }, x => k.push(x));
  erzeugeKatalog({ db: /** @type {any} */ ({}) }, x => k.push(x));
  const [k1, k2] = k;
  k1.faecher.fach('themenbaum', () => ({ n: 1 })).n = 2;
  assert.equal(k2.faecher.fach('themenbaum', () => ({ n: 1 })).n, 1);
});
