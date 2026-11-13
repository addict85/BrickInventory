/**
 * Die Nutzlast eines Auftrags hat je Art ein Schema (src/auftraege/nutzlasten.ts):
 * Beim Einstellen wird eine falsche abgewiesen, und der Worker übergibt nur
 * eine geprüfte. Eine Nutzlast, die ein früherer Stand geschrieben hat und
 * die nicht mehr passt, scheitert sofort endgültig und mit klarem Text.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in stelleAuftragEin() pruefeNutzlast() weggelassen → rot: „eine falsche
 *      Nutzlast wird beim Einstellen abgewiesen“ (die Zeile stand in der Tabelle)
 *   B  im Worker a.nutzlast statt der geprüften übergeben → rot: „der Worker
 *      übergibt die geprüfte Nutzlast“ (das Fremdfeld kam an)
 *   C  fehlgeschlagen() ohne sofortEndgueltig → rot: „eine alte Nutzlast
 *      scheitert sofort endgültig“ (Status offen für den zweiten Versuch)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

test('Nutzlasten der Aufträge', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const A = { ..._req('src/auftraege/dienst.js'), ..._req('src/auftraege/prozess.js').auftraegeBereich().auftraege };
  const { NutzlastUngueltig } = _req('src/auftraege/nutzlasten.js');
  const { erzeugeWorker } = _req('jobs/auftragsWorker.js');
  await db.run(`DELETE FROM auftraege WHERE art = 'brickset'`);

  await t.test('eine falsche Nutzlast wird beim Einstellen abgewiesen', async () => {
    await assert.rejects(
      A.stelleAuftragEin('brickset', { set_numbr: '10179-1' }),
      e => e instanceof NutzlastUngueltig && /brickset.*set_number/.test(e.message),
    );
    await assert.rejects(A.stelleAuftragEin('gibt-es-nicht', {}), NutzlastUngueltig);
    const n = await db.get(`SELECT COUNT(*)::int AS n FROM auftraege WHERE art = 'brickset'`);
    assert.equal(n.n, 0);
  });

  await t.test('der Worker übergibt die geprüfte Nutzlast', async () => {
    // Ein Feld, das ein älterer Stand mitschrieb, erreicht den Bearbeiter nicht.
    await db.run(`INSERT INTO auftraege (art, nutzlast, max_versuche) VALUES ('brickset', $1, 3)`, [
      JSON.stringify({ set_number: '10179-1', versuch: 2, altfeld: 'x' }),
    ]);
    const gesehen = [];
    const w = erzeugeWorker(
      {
        brickset: {
          ausfuehren: async n => {
            gesehen.push(n);
          },
        },
      },
      { fristSek: 60 },
    );
    assert.equal(await w.verarbeiteEinen(), true);
    assert.deepEqual(gesehen, [{ set_number: '10179-1', versuch: 2 }]);
  });

  await t.test('eine alte Nutzlast scheitert sofort endgültig', async () => {
    const { id } = await db.get(
      `INSERT INTO auftraege (art, nutzlast, max_versuche) VALUES ('brickset', $1, 3) RETURNING id`,
      [JSON.stringify({ setnummer: '10179-1' })],
    );
    let gelaufen = 0,
      aufgegeben = 0;
    const w = erzeugeWorker(
      {
        brickset: {
          ausfuehren: async () => {
            gelaufen++;
          },
          aufgegeben: async () => {
            aufgegeben++;
          },
        },
      },
      { fristSek: 60 },
    );
    assert.equal(await w.verarbeiteEinen(), true);
    const z = await db.get('SELECT status, versuche, fehler FROM auftraege WHERE id = $1', [id]);
    assert.equal(gelaufen, 0, 'der Bearbeiter lief mit einer ungültigen Nutzlast');
    assert.equal(aufgegeben, 0);
    assert.equal(z.status, 'fehler');
    assert.equal(z.versuche, 1);
    assert.match(z.fehler, /Nutzlast für brickset ungültig: set_number/);
  });
});
