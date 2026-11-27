/**
 * Which path the parts tab takes: the precomputed summary or the live query. The summary
 * is stale per account (statement trigger), set and storage filters go live, metrics only
 * read a current summary, and the household condenses the same part across accounts.
 *
 * Counter-checks (22.11.2026, each alone, template rebuilt for the SQL ones):
 *   A  0052: bump_parts_version_upd counts only `neu` → red “a part moving between accounts …”
 *   B  0052: the parts trigger FOR EACH ROW instead of FOR EACH STATEMENT → red “one statement, one step”
 *   C  partsQuery without `!filter.set_number` → red “set and storage filters go live” (source summary)
 *   D  partsQuery without `!filter.storage` → red the same test (wrong storage group)
 *   E  partStatsQuery calls summaryFresh without strict → red “metrics read no stale summary”
 *   F  summaryFresh: `results.some(Boolean)` → red “the household is fresh only if every account is”
 *   G  pageFromSummary without GROUP BY in the household → red “the same part … ONE row” (two rows)
 *   H  the household count without GROUP BY → red the same test (total 2)
 *   I  unique_parts as COUNT(*) → red the same test (colors and categories count 2)
 *   J  rebuildNow returns a running rebuild again (`if (running) return running`) → red
 *      “rebuildNow builds anew …” (“built from the current version”: false)
 *   K  “the list takes the old state” without whileLocked, the rebuild delayed by 300 ms in
 *      partsQuery before reading the summary → red there (6): the lock is what keeps it stale
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, handlerModule } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet, holdsPart } = require('./helpers/inventory');
const { until } = require('./helpers/time');

const P = process.pid;
const SN = `81${P}-1`,
  PART = `psp${P}`,
  OTHER = `psq${P}`;

test('parts summary: when the list reads it and when it goes live', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const H = handlerModule(_req);
  const PS = _req('src/parts/summary.js');
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const names = [`psp-a-${P}`, `psp-b-${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
  const ids = [];
  for (const n of names)
    ids.push((await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [n])).id);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.run('DELETE FROM part_catalog WHERE part_number = ANY($1)', [[PART, OTHER]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const [a, b] = ids;
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name, category_name) VALUES ($1,'Probe','Bricks'),($2,'Andere','Bricks')
                ON CONFLICT (part_number) DO NOTHING`,
    [PART, OTHER],
  );
  const box = (await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1,'Kiste') RETURNING id`, [a])).id;
  for (const u of ids) {
    await holdsSet(db, u, SN, 1);
    await holdsPart(db, u, PART, { setNumber: SN, quantity: 3, colorId: 4, storageId: u === a ? box : null });
  }
  const version = async u => Number((await db.get('SELECT v FROM parts_version_user WHERE user_id = $1', [u]))?.v ?? 0);
  /** Holds a lock the rebuild of account u needs, in an own transaction, while fn(pid of that backend) runs. */
  const whileLocked = async (
    u,
    fn,
    lock = 'SELECT pg_advisory_xact_lock($1, $2)',
    params = [LOCKS.PARTS_SUMMARY, u],
  ) => {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(lock, params);
      return await fn((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    } finally {
      await c.query('COMMIT').catch(() => {});
      c.release();
    }
  };

  await t.test('one statement, one step of the version counter', async () => {
    const before = await version(a);
    await db.run(
      `INSERT INTO parts (user_id, set_number, part_number, color_id, source)
         SELECT $1, $2, $3 || g, 4, 'set' FROM generate_series(1, 5) g`,
      [a, SN, 'x' + P],
    );
    assert.equal(await version(a), before + 1);
    await db.run(`DELETE FROM parts WHERE user_id = $1 AND part_number LIKE $2`, [a, `x${P}%`]);
  });

  await t.test('a part moving between accounts invalidates sender and target', async () => {
    const [va, vb] = [await version(a), await version(b)];
    // A manual part of A goes to B.
    await holdsPart(db, a, OTHER, { quantity: 1, colorId: 2 });
    const [va2, vb2] = [await version(a), await version(b)];
    assert.ok(va2 > va && vb2 === vb, 'precondition: only A is touched');
    await db.run(`UPDATE parts SET user_id = $2 WHERE user_id = $1 AND part_number = $3`, [a, b, OTHER]);
    assert.ok((await version(a)) > va2, 'the sender is stale');
    assert.ok((await version(b)) > vb2, 'the target is stale');
    await db.run(`DELETE FROM parts WHERE part_number = $1`, [OTHER]);
  });

  for (const u of ids) await PS.rebuildNow(u);

  await t.test('set and storage filters go live, the plain list reads the summary', async () => {
    assert.equal((await H.partsQuery(a, { exclude_manual: '1' })).source, 'summary', 'precondition: fresh');
    const bySet = await H.partsQuery(a, { exclude_manual: '1', set_number: SN });
    assert.equal(bySet.source, 'db');
    const byBox = await H.partsQuery(a, { exclude_manual: '1', storage: 'Kiste' });
    assert.equal(byBox.source, 'db');
    assert.deepEqual(
      byBox.parts.map(p => p.part_number),
      [PART],
    );
  });

  await t.test('metrics read no stale summary, the list may', async () => {
    await db.run('UPDATE set_acquisitions SET quantity = 2 WHERE user_id = $1 AND set_number = $2', [a, SN]);
    // The read starts a background rebuild; under load it committed before the list read the summary.
    const list = await whileLocked(a, () => H.partsQuery(a, { exclude_manual: '1' }));
    assert.deepEqual([list.source, list.parts[0]?.total_quantity], ['summary', 3], 'the list takes the old state');
    assert.equal((await H.partStatsQuery(a)).total_parts, 6, 'the metrics count live');
    await db.run('UPDATE set_acquisitions SET quantity = 1 WHERE user_id = $1 AND set_number = $2', [a, SN]);
    for (const u of ids) await PS.rebuildNow(u);
  });

  await t.test('rebuildNow builds anew after a running rebuild that read an older state', async () => {
    await PS.rebuildNow(a);
    const quantity = n =>
      db.run('UPDATE set_acquisitions SET quantity = $3 WHERE user_id = $1 AND set_number = $2', [a, SN, n]);
    let done;
    // The background rebuild reads quantity 2, then waits on its state row until rebuildNow was asked.
    await whileLocked(
      a,
      async pid => {
        await quantity(2);
        await PS.summaryFresh(a);
        const waiting = async () =>
          (await db.get('SELECT count(*)::int AS n FROM pg_locks WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])).n > 0;
        assert.ok(await until(waiting), 'precondition: the background rebuild waits on the state row');
        await quantity(1);
        done = PS.rebuildNow(a);
      },
      'SELECT 1 FROM parts_summary_state WHERE user_id = $1 FOR UPDATE',
      [a],
    );
    await done;
    assert.equal(await PS.summaryFresh(a, { strict: true }), true, 'built from the current version');
    assert.equal((await H.partsQuery(a, { exclude_manual: '1' })).parts[0]?.total_quantity, 3);
  });

  await t.test('the household is fresh only if every account is', async () => {
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [a, b]);
    for (const u of ids) await PS.rebuildNow(u);
    assert.equal(await PS.summaryFresh([a, b], { strict: true }), true, 'precondition: both fresh');
    await db.run('UPDATE set_acquisitions SET quantity = 2 WHERE user_id = $1 AND set_number = $2', [b, SN]);
    assert.equal(await PS.summaryFresh([a, b], { strict: true }), false);
    await db.run('UPDATE set_acquisitions SET quantity = 1 WHERE user_id = $1 AND set_number = $2', [b, SN]);
    for (const u of ids) await PS.rebuildNow(u);
  });

  await t.test('the same part in two accounts is ONE row with the sum', async () => {
    const list = await H.partsQuery([a, b], { exclude_manual: '1' });
    assert.equal(list.source, 'summary');
    assert.deepEqual([list.total, list.parts.map(p => [p.part_number, p.total_quantity])], [1, [[PART, 6]]]);
    const colors = await H.partColorsQuery([a, b]);
    assert.deepEqual(
      colors.map(c => c.unique_parts),
      [1],
    );
    const cats = await H.partCategoriesQuery([a, b]);
    assert.deepEqual(
      cats.map(c => c.unique_parts),
      [1],
    );
  });
});
