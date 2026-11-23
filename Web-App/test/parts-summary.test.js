/**
 * Precomputed parts summary (src/parts/summary.ts). Which path the list takes (filters,
 * metrics, household, triggers): parts-summary-paths-db.test.js.
 *
 * Counter-checks (22.11.2026, each alone):
 *   A  partsQuery without `if (summary) return summary` → red “summary matches …” (source db)
 *   B  summaryFresh rebuilds in the request instead of rebuildInBackground → red the same test (no stale state)
 *   C  summaryFresh `return true` instead of `state !== null` → red the same test (first read not live)
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const { holdsSet, holdsPart } = require('./helpers/inventory');
const { noDb } = require('./helpers/db');

const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// ── Integration test (only with DB) ──────────────────────────────────────────
let db,
  H,
  PS,
  S,
  skip = null;
try {
  // Build into dist/ instead of in place — see helpers/sources.js.
  const _req = require('./helpers/sources').buildAndRequire();
  process.env.DATABASE_URL = DB_URL;
  environment({ SESSION_SECRET: 'test' });
  db = testData();
  H = require('./helpers/sources').handlerModule(_req);
  PS = _req('src/parts/summary.js');
  S = _req('src/inventory/metrics.js');
} catch (e) {
  skip = e.message;
}

test('summary matches the live query and does not go stale', { skip: skip || undefined }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    noDb(t, e);
    return;
  }

  const U = 990501;
  const clean = async () => {
    await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
    await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
    await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
    await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
    await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  };
  await clean();
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum','x',false) ON CONFLICT DO NOTHING",
    [U],
  );
  // Two sets, the second one present twice — the quantity must be multiplied along.
  await holdsSet(db, U, 'A-1', 1);
  await holdsSet(db, U, 'B-1', 2);
  // Since migration 0034 color label and name stand in the catalogs.
  // Not incidental here: the checks below look for the group via
  // `color_name === 'Rot'`.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES
    ('3001','Brick 2x4'),('3002','Plate 1x2'),('3003','Tile 1x1')
    ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
    ('3001',5,'Rot'),('3002',1,'Blau'),('3003',2,'Gruen')
    ON CONFLICT (part_number, color_id) DO NOTHING`);
  await holdsPart(db, U, '3001', { setNumber: 'A-1', quantity: 3, colorId: 5 });
  await holdsPart(db, U, '3001', { setNumber: 'B-1', quantity: 4, colorId: 5 });
  await holdsPart(db, U, '3002', { setNumber: 'A-1', quantity: 1, colorId: 1 });
  // The set list for 3003 already stands in the catalog now; below only the
  // stock row is added (a catalog change would update the group immediately).
  await db.run(`INSERT INTO set_parts (set_number, part_number, color_id, quantity) VALUES ('A-1','3003',2,9)
                ON CONFLICT (set_number, part_number, color_id) DO UPDATE SET quantity = 9`);

  // Since the fix summaryFresh() NO longer builds in the request. The first
  // access of a user without a summary is therefore served from the
  // live query while the build starts in the background. For the
  // content check here it is built explicitly once.
  const first = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(first.source, 'db', 'without an existing summary the live query must step in instead of waiting');
  await PS.rebuildNow(U);

  const r1 = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(r1.source, 'summary', 'the summary was not used');
  assert.equal(r1.total, 2, 'two part/colour groups expected');
  const rot = r1.parts.find(p => p.color_name === 'Rot');
  assert.equal(rot.total_quantity, 3 * 1 + 4 * 2, 'the set quantity must go into the part quantity');

  // Change to parts → trigger → next read access rebuilds
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id, source) VALUES ($1,'A-1','3003',2,'set')`,
    [U],
  );
  // The read access must NOT block any more now: it delivers the old
  // state and only triggers the build. Only afterwards are the numbers right again.
  const stale = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(stale.total, 2, 'the read should return the old state, not wait');
  await PS.rebuildNow(U);
  const r2 = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(r2.total, 3, 'after building, the new group must be included');

  // Change to the SET QUANTITY → likewise. Since migration 0036 it stands in
  // the acquisition, no longer in sets.quantity — and that is why the
  // invalidation trigger now also hangs on set_acquisitions (src/parts/summary.ts).
  // Without it the number here would stay and look plausible while doing so.
  await db.run("UPDATE set_acquisitions SET quantity=3 WHERE user_id=$1 AND set_number='B-1'", [U]);
  await PS.rebuildNow(U);
  const r3 = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 50 });
  const rot3 = r3.parts.find(p => p.color_name === 'Rot');
  assert.equal(rot3.total_quantity, 3 * 1 + 4 * 3, 'a changed set quantity must come through');

  // The write of a FOREIGN account must invalidate nothing
  const FREMD = 990502;
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum2','x',false) ON CONFLICT DO NOTHING",
    [FREMD],
  );
  await PS.rebuildNow(U);
  assert.equal(await PS.summaryFresh(U, { strict: true }), true, 'precondition: the own summary is fresh');
  await holdsPart(db, FREMD, '9999', { quantity: 1, colorId: 7 });
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    true,
    'A foreign account must not invalidate the own summary',
  );
  // The own change, on the other hand, does. `updated_at=updated_at` writes
  // nothing new — the trigger hangs on the UPDATE, not on the value.
  await db.run("UPDATE sets SET updated_at=updated_at WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(await PS.summaryFresh(U, { strict: true }), false, 'An own change to sets must invalidate the summary');

  // ── And a change to the ACQUISITIONS likewise ─────────────────────────
  //
  // New with migration 0036: the set quantity stands there. Without the trigger on
  // set_acquisitions this assertion would be the only place at which the
  // error would show — and it is here exactly for that reason.
  await PS.rebuildNow(U);
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    true,
    'precondition: after the rebuild the summary is fresh',
  );
  // A changed purchase price does not invalidate (since 0052), a quantity does.
  await db.run("UPDATE set_acquisitions SET purchase_price = 1 WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    true,
    'A purchase price changes no part quantity — the summary stays valid',
  );
  await db.run("UPDATE set_acquisitions SET quantity=quantity+1 WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(
    await PS.summaryFresh(U, { strict: true }),
    false,
    'A change to the acquisitions must invalidate the summary — the ' +
      'set quantity lives there (migration 0036), and total_quantity computes with it',
  );
  await db.run('DELETE FROM parts WHERE user_id=$1', [FREMD]);
  await PS.rebuildNow(U);

  // Statistics and color filter come from the same source
  const stats = await H.partStatsQuery(U);
  assert.equal(stats.unique_parts, 3);
  const colors = await H.partColorsQuery(U);
  assert.equal(colors.length, 3);

  // page limits
  const p1 = await H.partsQuery(U, { exclude_manual: '1', page: 1, page_size: 2 });
  const p2 = await H.partsQuery(U, { exclude_manual: '1', page: 2, page_size: 2 });
  assert.equal(p1.parts.length, 2);
  assert.equal(p2.parts.length, 1);
  assert.equal(p1.total, 3, 'total must be the overall count, not that of the page');

  await clean();
  await db.run('DELETE FROM users WHERE id=$1', [U]);
});

test('both paths of the metrics count THE SAME — also with manual parts', { skip: skip || undefined }, async t => {
  // The finding
  try {
    await db.initSchema();
  } catch (e) {
    noDb(t, e);
    return;
  }

  const U = 990502;
  await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
  await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum2','x',false) ON CONFLICT DO NOTHING",
    [U],
  );
  await holdsSet(db, U, 'A-1', 1);
  await holdsPart(db, U, '3001', { setNumber: 'A-1', quantity: 3, colorId: 5 });
  await holdsPart(db, U, '9999', { quantity: 11, colorId: 7 });

  // Path 1: from the summary.
  await PS.rebuildNow(U);
  const fromSummary = await H.partStatsQuery([U]);

  // Path 2: the fallback. The summary is removed for it — then
  // summaryFresh(strict) delivers false, and partStatsQuery goes live.
  await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  const fromLive = await H.partStatsQuery([U]);

  assert.deepEqual(
    fromLive,
    fromSummary,
    'The two paths count different things. From the summary: ' +
      `${JSON.stringify(fromSummary)}, live: ${JSON.stringify(fromLive)}. ` +
      'The manually recorded part (quantity 11) belongs in none of the set quantities.',
  );

  // Kinds and colors count both sources, like the list below (see
  // parts-metrics-single-db.test.js); the quantity stays separated by source.
  assert.equal(fromSummary.unique_parts, 2, 'The manual part is missing in the kinds');
  assert.equal(fromSummary.unique_colors, 2, 'The colour of the manual part is missing');
  assert.equal(fromSummary.total_parts, 3, 'The quantity of the manual part is in the total');
  // Shown separately: the parts tab counts both together, like the
  // tile of the collection (/v2/stats). Counter-check (01.11.2026): manual_parts in
  // kennzahlen() fixed to 0 → red „Die einzeln erfassten Teile fehlen …“.
  assert.equal(fromSummary.manual_parts, 11, 'The individually recorded parts are missing in the breakdown');
  const total = await S.getStats([U]);
  assert.deepEqual(
    [total.total_parts, total.set_parts, total.manual_parts],
    [14, 3, 11],
    'The collection tile does not show the same total as the parts tab',
  );

  await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
  await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
});

// Close the connection pool — otherwise the test process hangs after the last
// test and the runner reports the file as failed, although every
// check was green. Without a reachable database this never showed: then
// no connection was opened at all.
test('close connections', async () => {
  await db.pool.end().catch(() => {});
});
