/**
 * Die Set-Dienste unterscheiden „fehlgeschlagen“ von „leer“ (src/infra/ergebnis.ts).
 *
 * Gegenproben (09.11.2026 gemessen):
 *   A  in teilelisteDesSets() nach dem Fehlschlag wieder mit null weitergerechnet (wie meldeUndLiefere) → rot:
 *      „eine gestörte Quelle ist keine leere Liste“ (source 'not_found', kein error)
 *   B  in figurenlisteDesSets() dasselbe → rot: „… auch bei den Figuren“
 *   C  in zieheNach() den Stand am Ende weggelassen → rot: „die Nacharbeit nennt gescheiterte Schritte“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testQuellen } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

/** Ein gebautes Modul im require-Zwischenspeicher ersetzen, bevor die Dienste es herausziehen. */
function ersetze(rel, felder) {
  const p = require.resolve(path.join(ROOT, 'dist', rel));
  const echt = require(p);
  require.cache[p].exports = Object.assign({}, echt, felder);
}
let rebrickable = 'gestoert';
const stoerung = async () => {
  if (rebrickable === 'gestoert') throw new Error('Rebrickable antwortet nicht');
  return null;
};
ersetze('src/katalog/rebrickableKatalog.js', { getAllSetParts: stoerung });
testQuellen(null, { getSetMinifigs: stoerung });
// Die Nacharbeit: Teile und Figuren gelingen, zwei Anreicherungen scheitern.
const still = async () => {};
ersetze('src/katalog/partsImport.js', { importiereTeile: still, blNummernNachladen: still });
ersetze('src/katalog/minifigsImport.js', { importiereFiguren: still });
ersetze('src/auftraege/anleitungsAuftrag.js', { anleitungEinreihen: still });
ersetze('src/katalog/teileAnreicherung.js', {
  enrichSetParts: stoerung,
  enrichSetMinifigs: still,
  downloadSetImages: stoerung,
});

test('Ergebnis: Wert, Ersatz und gemeldeter Fehlschlag', async () => {
  const { versuche, wertOder } = _req('src/infra/ergebnis.js');
  assert.deepEqual(await versuche('probe', Promise.resolve([])), { ok: true, wert: [] });
  const r = await versuche('probe', async () => {
    throw new Error('weg');
  });
  assert.deepEqual(r, { ok: false, fehler: { kontext: 'probe', grund: 'weg' } });
  assert.equal(wertOder(r, 'ersatz'), 'ersatz');
});

test('Set-Dienste: Fehlschlag statt leer', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const SN = `99${String(process.pid).slice(-4)}-1`;
  const { teilelisteDesSets, figurenlisteDesSets } = require('./helpers/sources').bereichsSeite('sets');

  await t.test('eine gestörte Quelle ist keine leere Liste', async () => {
    rebrickable = 'gestoert';
    const r = await teilelisteDesSets(SN, async () => {});
    assert.equal(r.source, 'quelle_gestoert');
    assert.match(r.error, /Rebrickable antwortet nicht/);
    rebrickable = 'leer';
    const leer = await teilelisteDesSets(SN, async () => {});
    assert.equal(leer.source, 'not_found');
    assert.equal(leer.error, undefined);
  });

  await t.test('… auch bei den Figuren', async () => {
    rebrickable = 'gestoert';
    const r = await figurenlisteDesSets(SN);
    assert.equal(r.source, 'quelle_gestoert');
    rebrickable = 'leer';
    assert.equal((await figurenlisteDesSets(SN)).source, 'not_found');
  });

  await t.test('die Nacharbeit nennt gescheiterte Schritte', async () => {
    rebrickable = 'gestoert';
    const staende = [];
    const { zieheNach } = require('./helpers/sources').bereichsSeite('sets');
    // Mit Katalog und Bild: Die Nacharbeit fragt dann kein Netz für den Stamm, nur die Schritte danach.
    await require('./helpers/bestand').katalogSet(db, SN, { name: 'Stamm', image_local: `/images/sets/${SN}.jpg` });
    try {
      await zieheNach(SN, 0, 'zweit', {
        fortschritt: async f => {
          staende.push(f);
          return true;
        },
      });
    } finally {
      await db.run('DELETE FROM rb_sets WHERE set_num = $1', [SN]);
    }
    assert.deepEqual(
      staende.map(f => f.ohne),
      [['teile-anreichern', 'bilder']],
    );
  });
});
