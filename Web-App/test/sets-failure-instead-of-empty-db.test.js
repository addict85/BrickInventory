/**
 * The set services distinguish „failed“ from „empty“ (src/infra/result.ts).
 *
 * Counter-checks (measured 09.11.2026):
 *   A  in partListOfSets() after the failure again computed on with null (like reportAndDeliver) → red:
 *      “a disturbed source is not an empty list” (source 'not_found', no error)
 *   B  the same in minifigsListOfSets() → red: “… also for the minifigures”
 *   C  the state at the end left out in pullAfter() → red: “the follow-up work names failed steps”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

/** Replace a built module in the require cache before the services pull it out. */
function replace(rel, felder) {
  const p = require.resolve(path.join(ROOT, 'dist', rel));
  const echt = require(p);
  require.cache[p].exports = Object.assign({}, echt, felder);
}
let rebrickable = 'gestoert';
const outage = async () => {
  if (rebrickable === 'gestoert') throw new Error('Rebrickable antwortet nicht');
  return null;
};
replace('src/catalog/rebrickableCatalog.js', { allPartsOfSet: outage });
testSources(null, { getSetMinifigs: outage });
// The follow-up work: parts and figures succeed, two enrichments fail.
const still = async () => {};
replace('src/catalog/partsImport.js', { reloadBlNumbers: still });
replace('src/sets/setContentImport.js', { importParts: still, importMinifigs: still });
replace('src/catalog/instructionJob.js', { enqueueInstruction: still });
replace('src/catalog/partsEnrichment.js', {
  enrichSetParts: outage,
  enrichSetMinifigs: still,
  downloadSetImages: outage,
});

test('result: value, substitute and reported failure', async () => {
  const { attempts: versuche, valueOr } = _req('src/infra/result.js');
  assert.deepEqual(await versuche('probe', Promise.resolve([])), { ok: true, wert: [] });
  const r = await versuche('probe', async () => {
    throw new Error('weg');
  });
  assert.deepEqual(r, { ok: false, error: { kontext: 'probe', reason: 'weg' } });
  assert.equal(valueOr(r, 'ersatz'), 'ersatz');
});

test('set services: failure instead of empty', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const SN = `99${String(process.pid).slice(-4)}-1`;
  const { minifigsListOfSets } = require('./helpers/sources').areaPage('sets');
  const { partListOfSets } = _req('src/sets/content.js');

  await t.test('a disturbed source is not an empty list', async () => {
    rebrickable = 'gestoert';
    const r = await partListOfSets(require('./helpers/sources').testContext('sets'), SN, async () => {});
    assert.equal(r.source, 'quelle_gestoert');
    assert.match(r.error, /Rebrickable antwortet nicht/);
    rebrickable = 'leer';
    const leer = await partListOfSets(require('./helpers/sources').testContext('sets'), SN, async () => {});
    assert.equal(leer.source, 'not_found');
    assert.equal(leer.error, undefined);
  });

  await t.test('… also for the minifigures', async () => {
    rebrickable = 'gestoert';
    const r = await minifigsListOfSets(SN);
    assert.equal(r.source, 'quelle_gestoert');
    rebrickable = 'leer';
    assert.equal((await minifigsListOfSets(SN)).source, 'not_found');
  });

  await t.test('the follow-up work names failed steps', async () => {
    rebrickable = 'gestoert';
    const states = [];
    // Via the registered kind, as the worker executes it.
    const nacharbeit = require('./helpers/sources')
      .testServices()
      .jobQueue.signedInKinds()
      .find(a => a.kind === 'rework');
    // With catalog and image: the follow-up work then asks no network for the master, only the steps after it.
    await require('./helpers/inventory').catalogSet(db, SN, { name: 'Stamm', image_local: `/images/sets/${SN}.jpg` });
    try {
      await nacharbeit.ausfuehren(
        { set_number: SN, user_id: 0, kind: 'zweit' },
        {
          progress: async f => {
            states.push(f);
            return true;
          },
        },
      );
    } finally {
      await db.run('DELETE FROM rb_sets WHERE set_num = $1', [SN]);
    }
    assert.deepEqual(
      states.map(f => f.ohne),
      [['teile-anreichern', 'bilder']],
    );
  });
});
