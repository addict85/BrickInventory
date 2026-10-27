/**
 * Ein Import, dessen Prozess nicht mehr lebt (Neustart, Absturz), sperrt
 * keinen weiteren: Ohne Lebenszeichen seit VERWAIST_MIN Minuten gilt er als
 * unterbrochen. Vorher blieb „running" für immer stehen, und starteAuftrag
 * verweigerte jeden neuen Auftrag, bis jemand von Hand abbrach.
 *
 * Gegenprobe (am 27.10. gemessen): das UPDATE in jobGet entfernt → rot:
 * „ein verwaister Auftrag" (Status blieb running, kein neuer Auftrag).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { jobGet, starteAuftrag, VERWAIST_MIN } = _req('utils/importAuftrag.js');

const NAME = `verwaist_${process.pid}`;

test('verwaiste Importe', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', 1, 1) RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const auftrag = (vorMin) => db.run(
    `INSERT INTO csv_import_jobs (user_id, status, total, done, current, updated_at)
     VALUES ($1, 'running', 10, 3, '10001-1', NOW() - make_interval(mins => $2))
     ON CONFLICT (user_id) DO UPDATE SET status = 'running', current = '10001-1', error = NULL,
       updated_at = NOW() - make_interval(mins => $2)`, [uid, vorMin]);

  await t.test('ein laufender Auftrag bleibt', async () => {
    await auftrag(1);
    assert.equal((await jobGet(uid)).status, 'running');
    assert.equal(await starteAuftrag(uid, { total: 5 }), false, 'Ein zweiter Auftrag verdrängt den laufenden');
  });

  await t.test('ein verwaister Auftrag', async () => {
    await auftrag(VERWAIST_MIN + 1);
    const stand = await jobGet(uid);
    assert.equal(stand.status, 'error');
    assert.match(stand.error, /unterbrochen/);
    assert.equal(stand.current, null);
    assert.equal(await starteAuftrag(uid, { total: 5 }), true, 'Der verwaiste Auftrag sperrt weiter');
  });
});
