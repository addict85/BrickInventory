/**
 * Die Set-Dienste unterscheiden „fehlgeschlagen“ von „leer“ (src/infra/ergebnis.ts).
 *
 * Gegenproben (09.11.2026 gemessen):
 *   A  in partListOfSets() nach dem Fehlschlag wieder mit null weitergerechnet (wie reportAndDeliver) → rot:
 *      „eine gestörte Quelle ist keine leere Liste“ (source 'not_found', kein error)
 *   B  in minifigsListOfSets() dasselbe → rot: „… auch bei den Figuren“
 *   C  in pullAfter() den Stand am Ende weggelassen → rot: „die Nacharbeit nennt gescheiterte Schritte“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

/** Ein gebautes Modul im require-Zwischenspeicher ersetzen, bevor die Dienste es herausziehen. */
function replace(rel, felder) {
  const p = require.resolve(path.join(ROOT, 'dist', rel));
  const echt = require(p);
  require.cache[p].exports = Object.assign({}, echt, felder);
}
let rebrickable = 'gestoert';
const stoerung = async () => {
  if (rebrickable === 'gestoert') throw new Error('Rebrickable antwortet nicht');
  return null;
};
replace('src/catalog/rebrickableCatalog.js', { alleTeileDesSets: stoerung });
testSources(null, { getSetMinifigs: stoerung });
// Die Nacharbeit: Teile und Figuren gelingen, zwei Anreicherungen scheitern.
const still = async () => {};
replace('src/catalog/partsImport.js', { reloadBlNumbers: still });
replace('src/sets/setInhaltImport.js', { importParts: still, importMinifigs: still });
replace('src/catalog/instructionJob.js', { anleitungEinreihen: still });
replace('src/catalog/partsEnrichment.js', {
  enrichSetParts: stoerung,
  enrichSetMinifigs: still,
  downloadSetImages: stoerung,
});

test('Ergebnis: Wert, Ersatz und gemeldeter Fehlschlag', async () => {
  const { versuche, valueOr } = _req('src/infra/ergebnis.js');
  assert.deepEqual(await versuche('probe', Promise.resolve([])), { ok: true, wert: [] });
  const r = await versuche('probe', async () => {
    throw new Error('weg');
  });
  assert.deepEqual(r, { ok: false, fehler: { kontext: 'probe', grund: 'weg' } });
  assert.equal(valueOr(r, 'ersatz'), 'ersatz');
});

test('Set-Dienste: Fehlschlag statt leer', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const SN = `99${String(process.pid).slice(-4)}-1`;
  const { minifigsListOfSets } = require('./helpers/sources').areaPage('sets');
  const { partListOfSets } = _req('src/sets/inhalt.js');

  await t.test('eine gestörte Quelle ist keine leere Liste', async () => {
    rebrickable = 'gestoert';
    const r = await partListOfSets(require('./helpers/sources').testContext('sets'), SN, async () => {});
    assert.equal(r.source, 'quelle_gestoert');
    assert.match(r.error, /Rebrickable antwortet nicht/);
    rebrickable = 'leer';
    const leer = await partListOfSets(require('./helpers/sources').testContext('sets'), SN, async () => {});
    assert.equal(leer.source, 'not_found');
    assert.equal(leer.error, undefined);
  });

  await t.test('… auch bei den Figuren', async () => {
    rebrickable = 'gestoert';
    const r = await minifigsListOfSets(SN);
    assert.equal(r.source, 'quelle_gestoert');
    rebrickable = 'leer';
    assert.equal((await minifigsListOfSets(SN)).source, 'not_found');
  });

  await t.test('die Nacharbeit nennt gescheiterte Schritte', async () => {
    rebrickable = 'gestoert';
    const states = [];
    // Über die angemeldete Art, wie der Worker sie ausführt.
    const nacharbeit = require('./helpers/sources')
      .testServices()
      .jobQueue.signedInKinds()
      .find(a => a.art === 'nacharbeit');
    // Mit Katalog und Bild: Die Nacharbeit fragt dann kein Netz für den Stamm, nur die Schritte danach.
    await require('./helpers/bestand').catalogSet(db, SN, { name: 'Stamm', image_local: `/images/sets/${SN}.jpg` });
    try {
      await nacharbeit.ausfuehren(
        { set_number: SN, user_id: 0, art: 'zweit' },
        {
          fortschritt: async f => {
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
