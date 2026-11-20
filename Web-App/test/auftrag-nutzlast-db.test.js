/**
 * Die Nutzlast eines Auftrags hat je Art ein Schema (src/jobQueue/kinds.ts):
 * Beim Einstellen wird eine falsche abgewiesen, und der Worker übergibt nur
 * eine geprüfte. Eine Nutzlast, die ein früherer Stand geschrieben hat und
 * die nicht mehr passt, scheitert sofort endgültig und mit klarem Text.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in placeJobOne() checkPayload() weggelassen → rot: „eine falsche
 *      Nutzlast wird beim Einstellen abgewiesen“ (die Zeile stand in der Tabelle)
 *   B  im Worker a.payload statt der geprüften übergeben → rot: „der Worker
 *      übergibt die geprüfte Nutzlast“ (das Fremdfeld kam an)
 *   C  fehlgeschlagen() ohne immediatelyFinal → rot: „eine alte Nutzlast
 *      scheitert sofort endgültig“ (Status offen für den zweiten Versuch)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('Nutzlasten der Aufträge', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const A = { ..._req('src/jobQueue/service.js'), ...require('./helpers/sources').testArea('jobQueue').auftraege };
  const { PayloadInvalid } = _req('src/jobQueue/kinds.js');
  const { createWorker } = _req('jobs/auftragsWorker.js');
  await db.run(`DELETE FROM jobs WHERE type = 'brickset'`);

  await t.test('eine falsche Nutzlast wird beim Einstellen abgewiesen', async () => {
    await assert.rejects(
      A.placeJobOne('brickset', { set_numbr: '10179-1' }),
      (/** @type {any} */ e) => e instanceof PayloadInvalid && /brickset.*set_number/.test(e.message),
    );
    await assert.rejects(A.placeJobOne('gibt-es-nicht', {}), PayloadInvalid);
    const n = await db.get(`SELECT COUNT(*)::int AS n FROM jobs WHERE type = 'brickset'`);
    assert.equal(n.n, 0);
  });

  await t.test('der Worker übergibt die geprüfte Nutzlast', async () => {
    // Ein Feld, das ein älterer Stand mitschrieb, erreicht den Bearbeiter nicht.
    await db.run(`INSERT INTO jobs (type, payload, max_attempts) VALUES ('brickset', $1, 3)`, [
      JSON.stringify({ set_number: '10179-1', versuch: 2, legacyField: 'x' }),
    ]);
    const gesehen = [];
    const w = createWorker(
      require('./helpers/sources').testServices().jobQueue,
      {
        brickset: {
          ausfuehren: async n => {
            gesehen.push(n);
          },
        },
      },
      { deadlineSec: 60 },
    );
    assert.equal(await w.processOne(), true);
    assert.deepEqual(gesehen, [{ set_number: '10179-1', versuch: 2 }]);
  });

  await t.test('eine alte Nutzlast scheitert sofort endgültig', async () => {
    const { id } = await db.get(
      `INSERT INTO jobs (type, payload, max_attempts) VALUES ('brickset', $1, 3) RETURNING id`,
      [JSON.stringify({ setnummer: '10179-1' })],
    );
    let gelaufen = 0,
      aufgegeben = 0;
    const w = createWorker(
      require('./helpers/sources').testServices().jobQueue,
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
      { deadlineSec: 60 },
    );
    assert.equal(await w.processOne(), true);
    const z = await db.get('SELECT status, attempts, error_message FROM jobs WHERE id = $1', [id]);
    assert.equal(gelaufen, 0, 'der Bearbeiter lief mit einer ungültigen Nutzlast');
    assert.equal(aufgegeben, 0);
    assert.equal(z.status, 'fehler');
    assert.equal(z.attempts, 1);
    assert.match(z.error_message, /Nutzlast für brickset ungültig: set_number/);
  });
});
