/**
 * After a bulk insert the table is refreshed — otherwise the
 * planner takes the wrong index.
 *
 * ── Counter-checks (carried out) ─────────────────────────────────────────────
 *
 *   a) maintainTable() does not throw if executing fails — own
 *      case below, with an executor that always throws.
 *   b) a name that is not a simple table name executes NOTHING —
 *      own case that counts how often the executor was called.
 *   c) the ANALYZE removed in rebuild() → the case “rebuild() refreshes”
 *      turns red (last_analyze does not move).
 *   d) an index set back via ALTER INDEX … SET (fastupdate = on) →
 *      the case “no pending list” turns red (c and d measured on 28.10.2026).
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { maintainTable } = _req('db/maintainTable.js');

/** When was the table last cleaned up and measured? */
async function state(table) {
  const r = await db.get(`SELECT last_vacuum, last_analyze FROM pg_stat_user_tables WHERE relname = $1`, [table]);
  return {
    vacuum: r?.last_vacuum ? new Date(r.last_vacuum).getTime() : 0,
    analyze: r?.last_analyze ? new Date(r.last_analyze).getTime() : 0,
  };
}

/**
 * Wait for the statistics. Postgres does not write them synchronously with the command —
 * without this loop the test hangs on the whim of the collector.
 */
async function waitOnStatus(table, prior, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const now = await state(table);
    if (now.vacuum > prior.vacuum && now.analyze > prior.analyze) return now;
    if (Date.now() > end) return now;
    await new Promise(r => setTimeout(r, 100));
  }
}

test('refresh after bulk insert', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  // A real account: since migration 0043 parts_summary has a key on users.
  const NAME = `pflege_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('maintainTable cleans up AND re-measures', async () => {
    // First insert something, so that there is something to do.
    await db.run(
      `INSERT INTO parts_summary (user_id, part_key, color_id, part_number,
        part_name, total_quantity, in_sets)
      SELECT $1, 'pflege'||g, 0, 'p'||g, 'Brick '||g, 1, 'x'
      FROM generate_series(1, 200) g ON CONFLICT DO NOTHING`,
      [uid],
    );
    const prior = await state('parts_summary');
    await new Promise(r => setTimeout(r, 1100)); // Timestamps have second resolution in the display

    const ok = await maintainTable(sql => db.exec(sql), 'parts_summary');
    assert.equal(ok, true, 'maintainTable gave up — does the test run as owner of the table?');

    const later = await waitOnStatus('parts_summary', prior);
    assert.ok(
      later.vacuum > prior.vacuum,
      `last_vacuum did not move (${later.vacuum} vs ${prior.vacuum}). Without VACUUM ` +
        `the GIN pending list stays, and every search goes through it in addition.`,
    );
    assert.ok(
      later.analyze > prior.analyze,
      `last_analyze did not move. Without fresh statistics the planner estimates the ` +
        `table at one row and picks the wrong index.`,
    );
  });

  await t.test('a name that is not a table name executes NOTHING', async () => {
    const called = [];
    const runFrom = async sql => {
      called.push(sql);
    };
    for (const name of [
      'parts_summary; DROP TABLE users',
      'parts summary',
      '"parts"',
      'public.parts_summary',
      '',
      'Parts_Summary',
    ]) {
      const ok = await maintainTable(runFrom, name);
      assert.equal(ok, false, `"${name}" should have been rejected.`);
    }
    assert.deepEqual(called, [], `SQL was executed anyway for a rejected name: ${called.join(' | ')}`);
  });

  await t.test('a failure stays a failure and does not become a crash', async () => {
    // VACUUM needs privileges. An import that fails at the AFTERCARE would be
    // the wrong result — the data is then completely there.
    const ok = await maintainTable(async () => {
      throw new Error('permission denied for table');
    }, 'parts_summary');
    assert.equal(ok, false);
  });

  await t.test('rebuild() refreshes parts_summary', async () => {
    const { rebuildSummary: rebuild } = _req('src/parts/summary.js');
    const user = 90002;
    await db.run(
      `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')
                  ON CONFLICT (id) DO NOTHING`,
      [user, 'pflege-tester'],
    );
    // Description into the catalogs, inventory into parts (migration 0034).
    await db.run(`INSERT INTO part_catalog (part_number, part_name)
      SELECT 'p'||g, 'Brick '||g FROM generate_series(1, 300) g
      ON CONFLICT (part_number) DO NOTHING`);
    await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name)
      SELECT 'p'||g, 0, 'Red' FROM generate_series(1, 300) g
      ON CONFLICT (part_number, color_id) DO NOTHING`);
    // Without quantity: since migration 0038 the piece count of a set part is the
    // catalog number. Here only the NUMBER of rows (300) counts, not their value
    // — hence no catalog rows are needed for it; subsetFrom() falls back to
    // 1, and 1 stood here before as well.
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '75192-1') ON CONFLICT DO NOTHING`, [user]);
    await db.run(
      `INSERT INTO parts (user_id, set_number, part_number, color_id)
      SELECT $1, '75192-1', 'p'||g, 0
      FROM generate_series(1, 300) g ON CONFLICT DO NOTHING`,
      [user],
    );

    const prior = await state('parts_summary');
    await new Promise(r => setTimeout(r, 1100));
    await rebuild(user);
    const later = await waitOnStatus('parts_summary', prior);

    assert.ok(
      later.analyze > prior.analyze,
      `rebuild() did not analyse parts_summary (analyze ${later.analyze} vs ` +
        `${prior.analyze}). DELETE + INSERT of all rows of a user is a ` +
        `bulk insert — afterwards the statistics are skewed.`,
    );
  });

  await t.test('the trigram indexes of the summary keep no pending list', async () => {
    // Instead of VACUUM after every rebuild: without a pending list there is nothing to empty.
    const idx = await db.all(`SELECT c.relname, c.reloptions FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am a ON a.oid = c.relam
      WHERE i.indrelid = 'parts_summary'::regclass AND a.amname = 'gin'`);
    assert.ok(idx.length >= 3, `too few GIN indexes found: ${idx.map(r => r.relname).join(', ')}`);
    for (const r of idx)
      assert.ok(
        (r.reloptions || []).includes('fastupdate=off'),
        `${r.relname} collects entries in a pending list that only VACUUM empties`,
      );
  });
});
