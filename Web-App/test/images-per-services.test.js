/**
 * The images keep their state (miss markers, image demand, view) in the compartments
 * of their set of services, not in the module: two sets in one process (tests, tools)
 * do not fool each other. Nothing is queried; the access stays unused.
 *
 * Counter-checks (measured on 14.11.2026, each alone):
 *   A  in src/images/imageMisses.ts `stand` back as a module constant (one set of maps
 *      for all) → red: “a miss marker only applies to its set of services”
 *   B  in src/images/imageDemand.ts imageOnceReserve() with a module-wide
 *      cache → red: “every set remembers itself what it noted”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { buildServices } = _req('startup/wiring.js');

/** A set of services that records what was noted. */
function record() {
  const contexts = {};
  const d = buildServices(S.testAccess(), { contexts });
  return { d, queued: S.imageNotes(contexts.images).notes };
}

test('a negative result only applies to its set of services', () => {
  const a = record().d,
    b = record().d;
  a.images.rememberMissing('set:99901-1', 'HTTP 404 vom CDN');
  assert.equal(a.images.isKnownMissing('set:99901-1'), true);
  assert.equal(b.images.isKnownMissing('set:99901-1'), false);
});

test('every set remembers by itself what it reserved', () => {
  const a = record(),
    b = record();
  const url = 'https://cdn.rebrickable.com/media/sets/99902-1.jpg';
  a.d.images.imageOnceReserve(url, '99902-1');
  a.d.images.imageOnceReserve(url, '99902-1');
  b.d.images.imageOnceReserve(url, '99902-1');
  assert.deepEqual(a.queued, [[url, '99902-1']], 'only once within the deadline');
  assert.deepEqual(b.queued, [[url, '99902-1']], 'the second set does not know the reservation of the first');
});
