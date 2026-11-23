/**
 * The payload of a job has a schema per kind (src/jobQueue/kinds.ts):
 * on enqueuing a wrong one is rejected, and the worker only passes
 * a checked one. A payload written by an earlier state that
 * no longer fits fails finally immediately and with a clear text.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  checkPayload() omitted in placeJobOne() → red: “a wrong
 *      payload is rejected on enqueuing” (the row stood in the table)
 *   B  in the worker a.payload passed instead of the checked one → red: “the worker
 *      passes the checked payload” (the foreign field arrived)
 *   C  fehlgeschlagen() without immediatelyFinal → red: “an old payload
 *      fails finally immediately” (status open for the second attempt)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('payloads of the jobs', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const A = { ..._req('src/jobQueue/service.js'), ...require('./helpers/sources').testArea('jobQueue').jobs };
  const { PayloadInvalid } = _req('src/jobQueue/kinds.js');
  const { createWorker } = _req('jobs/jobWorker.js');
  await db.run(`DELETE FROM jobs WHERE type = 'brickset'`);

  await t.test('a wrong payload is rejected when queuing', async () => {
    await assert.rejects(
      A.placeJobOne('brickset', { set_numbr: '10179-1' }),
      (/** @type {any} */ e) => e instanceof PayloadInvalid && /brickset.*set_number/.test(e.message),
    );
    await assert.rejects(A.placeJobOne('gibt-es-nicht', {}), PayloadInvalid);
    const n = await db.get(`SELECT COUNT(*)::int AS n FROM jobs WHERE type = 'brickset'`);
    assert.equal(n.n, 0);
  });

  await t.test('the worker passes the checked payload', async () => {
    // A field an older state wrote along does not reach the handler.
    await db.run(`INSERT INTO jobs (type, payload, max_attempts) VALUES ('brickset', $1, 3)`, [
      JSON.stringify({ set_number: '10179-1', versuch: 2, legacyField: 'x' }),
    ]);
    const seen = [];
    const w = createWorker(
      require('./helpers/sources').testServices().jobQueue,
      {
        brickset: {
          run: async n => {
            seen.push(n);
          },
        },
      },
      { deadlineSec: 60 },
    );
    assert.equal(await w.processOne(), true);
    assert.deepEqual(seen, [{ set_number: '10179-1', versuch: 2 }]);
  });

  await t.test('an old payload fails immediately and permanently', async () => {
    const { id } = await db.get(
      `INSERT INTO jobs (type, payload, max_attempts) VALUES ('brickset', $1, 3) RETURNING id`,
      [JSON.stringify({ setNumber: '10179-1' })],
    );
    let ran = 0,
      abandoned = 0;
    const w = createWorker(
      require('./helpers/sources').testServices().jobQueue,
      {
        brickset: {
          run: async () => {
            ran++;
          },
          givenUp: async () => {
            abandoned++;
          },
        },
      },
      { deadlineSec: 60 },
    );
    assert.equal(await w.processOne(), true);
    const z = await db.get('SELECT status, attempts, error_message FROM jobs WHERE id = $1', [id]);
    assert.equal(ran, 0, 'the handler ran with an invalid payload');
    assert.equal(abandoned, 0);
    assert.equal(z.status, 'error');
    assert.equal(z.attempts, 1);
    assert.match(z.error_message, /Nutzlast für brickset ungültig: set_number/);
  });
});
