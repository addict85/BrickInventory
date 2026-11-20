/**
 * Ein Import, dessen Prozess nicht mehr lebt (Neustart, Absturz), sperrt
 * keinen weiteren: Ohne Lebenszeichen seit ORPHANED_MIN Minuten gilt er als
 * unterbrochen. Vorher blieb „running" für immer stehen, und startJob
 * verweigerte jeden neuen Auftrag, bis jemand von Hand abbrach.
 *
 * Gegenprobe (am 27.10. gemessen): das UPDATE in jobGet entfernt → rot:
 * „ein verwaister Auftrag" (Status blieb running, kein neuer Auftrag).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { jobGet, startJob, ORPHANED_MIN } = _req('src/auftraege/importAuftrag.js');

const NAME = `verwaist_${process.pid}`;

test('verwaiste Importe', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const auftrag = vorMin =>
    db.run(
      `INSERT INTO import_status (user_id, status, total, done, current, updated_at)
     VALUES ($1, 'running', 10, 3, '10001-1', NOW() - make_interval(mins => $2))
     ON CONFLICT (user_id) DO UPDATE SET status = 'running', current = '10001-1', error = NULL,
       updated_at = NOW() - make_interval(mins => $2)`,
      [uid, vorMin],
    );

  await t.test('ein laufender Auftrag bleibt', async () => {
    await auftrag(1);
    assert.equal((await jobGet(uid)).status, 'running');
    assert.equal(await startJob(uid, { total: 5 }), false, 'Ein zweiter Auftrag verdrängt den laufenden');
  });

  await t.test('ein verwaister Auftrag', async () => {
    await auftrag(ORPHANED_MIN + 1);
    const stand = await jobGet(uid);
    assert.equal(stand.status, 'error');
    assert.match(stand.error, /unterbrochen/);
    assert.equal(stand.current, null);
    assert.equal(await startJob(uid, { total: 5 }), true, 'Der verwaiste Auftrag sperrt weiter');
  });
});
