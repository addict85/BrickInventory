/**
 * Every job kind a scope declares (JobPayloads) is registered after buildServices():
 * otherwise the queue would accept it and no worker would ever execute it.
 *
 * Counter-checks (measured 15.11.2026, each alone):
 *   A  in startup/wiring.ts `...d.parts.jobKinds(),` deleted → red: buildServices throws
 *      KindNotSignedIn (“Auftragsart ohne Anmeldung: katalog_nachzug”), both tests red
 *   B  `brickset` deleted in DECLARED_KINDS → red in `npm run typecheck` (Property 'brickset'
 *      is missing) and here: “registered is exactly what is declared”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAndRequire, testServices } = require('./helpers/sources');

const _req = buildAndRequire();
const { DECLARED_KINDS } = _req('startup/wiring.js');

test('exactly what is declared is registered', () => {
  const angemeldet = testServices()
    .jobQueue.signedInKinds()
    .map(a => a.art)
    .sort();
  assert.ok(angemeldet.length > 15, `nur ${angemeldet.length} Arten angemeldet — greift die Verdrahtung noch?`);
  assert.deepEqual(angemeldet, Object.keys(DECLARED_KINDS).sort());
});

test('the Brickset resubmission registers its kind with payload, the run is provided by the catalog', async () => {
  const brickset = testServices()
    .jobQueue.signedInKinds()
    .find(a => a.art === 'brickset');
  assert.ok(brickset?.exklusiv, 'brickset ist exklusiv angemeldet');
  assert.equal(brickset.nutzlast.safeParse({ set_number: '10001-1', versuch: 2 }).success, true);
  assert.equal(brickset.nutzlast.safeParse({ set_number: '' }).success, false);
  assert.equal(typeof brickset.ausfuehren, 'function');
});
