/**
 * Every import runs as a job in the job process (src/jobQueue/importAsJob.ts):
 * the request submits and waits; without a job process the job stays open.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  in jobs/startJobs.ts csv_import always via runCsvImportFrom
 *      (without looking at `quelle`) → red: “with a worker the result comes”
 *   B  importAlsAuftrag() does not forget the result (setResult(id, null)
 *      deleted) → red: the same test (result stays in the table)
 *   C  importAlsAuftrag() calls importPartsCsv directly instead of submitting
 *      → red: “without a worker the job stays open” (and the second case)
 *   D  runImportFrom() does not catch the domain error → red: “a domain error
 *      arrives with a code” (500 import_failed)
 *   E  (14.11.2026) the calls here without asAccount (without the request's account) → red: all
 *      three (import_cancelled: jobStatus runs under row security and only sees the
 *      own job in the request's account).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { importWorker } = require('./helpers/jobs');
const path = require('node:path');

// Before loading the worker: the alert import throws a domain error.
const { fileError } = _req('src/infra/errorTexts.js');
const pa = require.resolve(path.join(require('./helpers/sources').DIST, 'src/finances/priceAlert.js'));
_req('src/finances/priceAlert.js');
require.cache[pa].exports = Object.assign({}, require.cache[pa].exports, {
  alertsFromCsv: async () => {
    throw fileError('invalid', 'alert_threshold_invalid');
  },
});

test('import as a job', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `importauftrag_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash, is_active) VALUES ($1, 'x', true) RETURNING id`, [NAME])
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  // Like the route: in the request's account; it reads its own job under row security.
  const { runImport: asJob } = _req('src/collection/importJobs.js');
  const importAsTask = (...a) => asAccount(uid, () => asJob(...a));
  const csv = teil => `part_number,color_id,quantity\n${teil},0,2\n`;

  await t.test('without a worker the job stays open', async () => {
    await assert.rejects(
      importAsTask(uid, 'teile_csv', { text: csv('ohne1') }, { waitMs: 300 }),
      (/** @type {any} */ e) => e.code === 'import_still_running' && e.kind === 'upstream_timeout',
    );
    const a = await db.get(
      `SELECT status, payload->>'source' AS source FROM jobs
      WHERE type = 'csv_import' AND user_id = $1 ORDER BY id DESC LIMIT 1`,
      [uid],
    );
    assert.deepEqual(a, { status: 'pending', source: 'teile_csv' });
    assert.equal(await db.get("SELECT 1 FROM parts WHERE user_id = $1 AND part_number = 'ohne1'", [uid]), undefined);
    await db.run("DELETE FROM jobs WHERE type = 'csv_import' AND user_id = $1", [uid]);
  });

  await t.test('with a worker the result comes', async tt => {
    importWorker(tt, _req);
    const r = await importAsTask(uid, 'teile_csv', { text: csv('mit1') });
    assert.equal(r.success, undefined, 'the envelope of the response is set by the route, not the service');
    assert.equal(r.total, 1);
    assert.equal(r.added + r.updated, 1, JSON.stringify(r));
    assert.ok(await db.get("SELECT 1 FROM parts WHERE user_id = $1 AND part_number = 'mit1'", [uid]));
    const a = await db.get(
      `SELECT status, result FROM jobs WHERE type = 'csv_import' AND user_id = $1
      ORDER BY id DESC LIMIT 1`,
      [uid],
    );
    assert.deepEqual(a, { status: 'done', result: null }, 'read is read');
  });

  await t.test('a domain error arrives with a code', async tt => {
    importWorker(tt, _req);
    await assert.rejects(
      importAsTask(uid, 'alarme_csv', { currency: 'CHF', text: 'set_number\n1-1\n' }),
      (/** @type {any} */ e) => e.code === 'alert_threshold_invalid' && e.kind === 'invalid',
    );
  });
});
