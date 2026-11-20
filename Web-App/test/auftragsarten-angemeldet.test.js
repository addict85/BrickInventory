/**
 * Jede Auftragsart, die ein Bereich deklariert (JobPayloads), ist nach buildServices()
 * angemeldet: Sonst nähme die Warteschlange sie an und kein Worker führte sie je aus.
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln):
 *   A  in startup/verdrahtung.ts `...d.parts.jobKinds(),` gestrichen → rot: buildServices wirft
 *      KindNotSignedIn („Auftragsart ohne Anmeldung: katalog_nachzug“), beide Tests rot
 *   B  in DECLARED_KINDS `brickset` gestrichen → rot in `npm run typecheck` (Property 'brickset'
 *      is missing) und hier: „angemeldet ist genau, was deklariert ist“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAndRequire, testServices } = require('./helpers/sources');

const _req = buildAndRequire();
const { DECLARED_KINDS } = _req('startup/verdrahtung.js');

test('angemeldet ist genau, was deklariert ist', () => {
  const angemeldet = testServices()
    .jobQueue.signedInKinds()
    .map(a => a.art)
    .sort();
  assert.ok(angemeldet.length > 15, `nur ${angemeldet.length} Arten angemeldet — greift die Verdrahtung noch?`);
  assert.deepEqual(angemeldet, Object.keys(DECLARED_KINDS).sort());
});

test('die Wiedervorlage von Brickset meldet ihre Art mit Nutzlast an, den Lauf gibt der Katalog', async () => {
  const brickset = testServices()
    .jobQueue.signedInKinds()
    .find(a => a.art === 'brickset');
  assert.ok(brickset?.exklusiv, 'brickset ist exklusiv angemeldet');
  assert.equal(brickset.nutzlast.safeParse({ set_number: '10001-1', versuch: 2 }).success, true);
  assert.equal(brickset.nutzlast.safeParse({ set_number: '' }).success, false);
  assert.equal(typeof brickset.ausfuehren, 'function');
});
