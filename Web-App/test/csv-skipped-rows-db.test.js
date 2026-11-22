/**
 * All three CSV imports (sets, parts, minifigures) tell the user about rows they skipped: over
 * the real server, parts and minifigures through the import job and its worker.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  the set import route without skipped_hint → red “sets”
 *   B  csvImportReport() without skipped_hint → red “parts” and “minifigures”
 *   C  csvReadIn() keeps rows without content instead of skipping them → red all three (no skipped)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testServices, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('CSV imports report skipped rows', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  // Names come with the rows; no lookup should leave the machine.
  testSources(t, {
    lookupPart: async () => null,
    getMinifigInfo: async () => null,
    bricklinkRequest: async () => ({ avg_price: '0', qty_avg_price: '0', total_quantity: '0' }),
  });
  const name = `csvskip-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1,'x',true,true) RETURNING id`,
      [name],
    )
  ).id;
  const worker = _req('jobs/startJobs.js').startJobWorker(testServices(), { arten: ['csv_import'], taktMs: 50 });
  t.after(async () => {
    await worker.stop(0);
    await require('./helpers/sources').testAccess().notification.close();
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: name }, t });
  const upload = async (p, csv) => {
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'x.csv');
    const r = await fetch(`${base}${p}`, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json() };
  };
  const reported = r => [
    r.status,
    r.body.skipped,
    typeof r.body.skipped_hint === 'string' && r.body.skipped_hint.length > 0,
  ];

  await t.test('sets', async () => {
    const r = await upload('/api/v2/sets/import/csv?check=1', 'set_number,quantity\n10294-1,1\n,\n');
    assert.deepEqual(reported(r), [200, 1, true], JSON.stringify(r.body));
  });
  await t.test('parts', async () => {
    const r = await upload(
      '/api/v2/parts/import/csv',
      `part_number,part_name,color_id,quantity\ncsk${process.pid},Probe,4,1\n,,,\n`,
    );
    assert.deepEqual(reported(r), [200, 1, true], JSON.stringify(r.body));
  });
  await t.test('minifigures', async () => {
    const r = await upload(
      '/api/v2/minifigs/import/csv',
      `fig_number,fig_name,quantity\nfig-csk${process.pid},Probe,1\n,,\n`,
    );
    assert.deepEqual(reported(r), [200, 1, true], JSON.stringify(r.body));
  });
});
