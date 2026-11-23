/**
 * Only the administrator may replace shared instructions (delete and refetch);
 * whoever has the set in the household only fetches missing ones. Otherwise an
 * instruction was gone for everyone if the sources delivered nothing on reloading.
 *
 * Counter-check (measured on 27.10.): the check for findSetInScope removed →
 * red: “a foreign account" (200, the instruction was deleted).
 *
 * Plus once per set and day for all accounts together; the administrator
 * is free. Counter-checks (measured on 30.10.):
 *   A  instructionNewLoadAllowed() not asked → red: “a second reload
 *      on the same day”
 *   B  the check possibleSetNumber() removed → red: “a number with
 *      path parts” (404 instead of 400)
 * Counter-checks (measured on 02.11.2026):
 *   C  the check for instructionCount() removed → red: “whoever has the set
 *      does not replace a shared instruction” (200 instead of 403)
 *   D  deleteInstructions() again for everyone → red: “a foreign account” and C
 * Since 05.11.2026 a job loads, the route answers 202. Counter-check:
 *   E  enqueueInstruction() not called in the route → red: “the reload
 *      is pending as a job”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const { holdsSet, catalogSet } = require('./helpers/inventory');

// No fetch at the sources: the reload finds nothing here.
const instrPath = require.resolve(path.join(require('./helpers/sources').DIST, 'src/catalog/instructions.js'));
const original = require(instrPath);
require.cache[instrPath].exports = Object.assign({}, original, { loadSetInstructions: async () => [] });

const db = testData();
const SET = '99072-1',
  URL_A = 'https://quelle.example/99072.pdf';
const NAMES = ['anl_halter', 'anl_fremd'].map(n => `${n}_${process.pid}`);

test('reload instructions', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMES]);
  const ids = [];
  for (const n of NAMES)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_active, email_verified)
                            VALUES ($1, 'x', true, true) RETURNING id`,
          [n],
        )
      ).id,
    );
  // ids[1] works as administrator below.
  await adminWithFactor(_req, ids[1]);
  await catalogSet(db, SET, { name: 'Anleitungsprobe', year: 2024, theme: 'Test', pieces: 10, minifigs: 0 });
  await holdsSet(db, ids[0], SET, 1);
  const instruction = () =>
    db.run(
      `INSERT INTO shared_instructions (set_number, url) VALUES ($1, $2)
                                  ON CONFLICT DO NOTHING`,
      [SET, URL_A],
    );
  const existing = async () => !!(await db.get('SELECT 1 AS ok FROM shared_instructions WHERE set_number = $1', [SET]));

  const throttle = () => db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`anleitung-neu|${SET}`]);
  await throttle();
  t.after(async () => {
    await throttle().catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [SET]).catch(() => {});
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const session = {};
  const { base } = testServer(_req, { session, t });
  const loadNew = async (as, number = SET) => {
    Object.assign(session, as);
    return (await fetch(`${base}/api/v2/sets/${number}/instructions`, { method: 'POST' })).status;
  };

  await t.test('a foreign account', async () => {
    await instruction();
    assert.equal(await loadNew({ userId: ids[1], isAdmin: false }), 404);
    assert.ok(await existing(), 'The shared instruction is gone although the account does not have the set');
  });

  await t.test('whoever has the set does not replace a shared instruction', async () => {
    await instruction();
    assert.equal(await loadNew({ userId: ids[0], isAdmin: false }), 403);
    assert.ok(await existing(), 'the shared instruction is gone for everyone');
  });

  await t.test('whoever has the set fetches a missing one once a day', async () => {
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [SET]);
    assert.equal(await loadNew({ userId: ids[0], isAdmin: false }), 202);
    assert.equal(await loadNew({ userId: ids[0], isAdmin: false }), 429);
    await db.run(`UPDATE rate_limit_attempts SET first_at = NOW() - INTERVAL '25 hours' WHERE key = $1`, [
      `anleitung-neu|${SET}`,
    ]);
    assert.equal(await loadNew({ userId: ids[0], isAdmin: false }), 202, 'after one day it works again');
  });

  await t.test('the admin replaces', async () => {
    await instruction();
    assert.equal(await loadNew({ userId: ids[1], isAdmin: true }), 202);
    assert.ok(!(await existing()), 'the admin did not replace the old row');
    const job = await db.get(`SELECT status FROM jobs WHERE type = 'instructions' AND dedupe_key = $1`, [
      `instructions:${SET}`,
    ]);
    assert.equal(job?.status, 'pending', 'the reload is pending as a job');
    await instruction();
    assert.equal(await loadNew({ userId: ids[1], isAdmin: true }), 202, 'the throttle does not hold the admin');
  });

  await t.test('a number with path parts', async () => {
    for (const raw of ['%2E%2E%2Fx', '%2E%2E%3Fx%3D', 'users'])
      assert.equal(await loadNew({ userId: ids[1], isAdmin: true }, raw), 400, raw);
  });
});
