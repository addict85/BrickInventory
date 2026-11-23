/**
 * The parts valuation must not ask four times per part.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const fc = _req('src/finances/financeCalc.js');
const { holdsPart } = require('./helpers/inventory');

const UID = 990101;
const N = 20; // enough so that „je Stück" can be told apart from „einmalig"
const NR = i => `bwt-teil-${i}`;

// Record all queries of this run.
const seen = [];
let count = false;
const altQuery = db.pool.query.bind(db.pool);
db.pool.query = (text, ...rest) => {
  if (count) {
    const sql = String(typeof text === 'string' ? text : text?.text || '').replace(/\s+/g, ' ');
    seen.push(sql);
  }
  return altQuery(text, ...rest);
};
const howOften = pattern => seen.filter(q => pattern.test(q)).length;

async function cleanUp() {
  await db.run('DELETE FROM parts WHERE user_id = $1', [UID]).catch(() => {});
  await db.run('DELETE FROM part_price_cache WHERE part_number LIKE $1', ['bwt-teil-%']).catch(() => {});
  await db.run("DELETE FROM bl_mapping WHERE type='part' AND rb_id LIKE $1", ['bwt-teil-%']).catch(() => {});
  await db.run('DELETE FROM users WHERE id = $1', [UID]).catch(() => {});
}

test('parts valuation: no lookup per part', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  try {
    await cleanUp();
    await db.run("INSERT INTO users (id, username, password_hash) VALUES ($1, 'bwt_messnutzer', 'x')", [UID]);
    for (let i = 0; i < N; i++) {
      // Since migration 0035 condition and price stand in the acquisition, the
      // piece count since 0038 — holdsPart() creates both.
      await holdsPart(db, UID, NR(i), { quantity: 1, colorId: 4 });
      // The production case: the backfill job has looked it up. A row with an
      // EMPTY bl_id means „no differing number" (migration 0037) —
      // so the price cache key stays the Rebrickable number.
      await db.run(
        "INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ('part', $1, NULL) ON CONFLICT (type, rb_id) DO UPDATE SET bl_id = NULL",
        [NR(i)],
      );
      // Warm price cache — the normal case. Without it one measures the
      // BrickLink fetch along, which no longer exists on the second call.
      for (const condition of ['N', 'U'])
        await db.run(
          `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price, fetched_at)
           VALUES ($1, 4, $2, 'EUR', 1.5, 1.4, NOW()) ON CONFLICT DO NOTHING`,
          [NR(i), condition],
        );
    }
    // Color table: rb_colors is remembered as a WHOLE. Without a row for color 4
    // the map would be empty and would deliberately not be remembered (see farbkarte).
    await db
      .run(
        'INSERT INTO rb_colors (id, name, bl_color_id) VALUES (4, $1, 4) ON CONFLICT (id) DO UPDATE SET bl_color_id = 4',
        ['Rot'],
      )
      .catch(() => {});

    seen.length = 0;
    count = true;
    const outcome = await fc.valueParts(UID, [UID]);
    count = false;

    assert.equal(outcome.parts.length, N, 'all parts valued');

    // ── 1. No SINGLE query per part any more ────────────────────────────────
    //
    // It is only ONE single query any more, not two: the fallback to
    // `parts.bl_part_number` is gone with migration 0037, because the second
    // source no longer exists (the reasoning stands in src/finances/calculation/prices.ts).
    assert.equal(
      howOften(/FROM bl_mapping WHERE type=\$1 AND rb_id=\$2/),
      0,
      'the mapping was queried one by one — the preloading (loadBlNumbersBefore) does not work',
    );

    // ── 2. Instead exactly one collective query ───────────────────────────
    assert.equal(
      howOften(/FROM bl_mapping WHERE type=\$1 AND rb_id = ANY\(\$2\)/),
      1,
      'the batch query on bl_mapping is missing or ran several times',
    );

    // ── 3. The color table at most once ────────────────────────────────
    // At most, not exactly: a previous test in the same process may already
    // have loaded it, and then zero is the right number.
    const colors = howOften(/FROM rb_colors/);
    assert.ok(colors <= 1, `rb_colors was queried ${colors}x — expected at most 1x for all parts`);

    // ── 4. The total stays below two round trips per part ───────────────
    // Counted: 1.1 per part (the price cache row plus a few one-off ones).
    // The limit stands at 2 so that it does not break on every harmless change
    // — but far below the 4.1 from before.
    assert.ok(
      seen.length < 2 * N,
      `${seen.length} queries for ${N} parts (${(seen.length / N).toFixed(1)} per part) — expected below 2 per part`,
    );

    // ── COUNTER-CHECK ────────────────────────────────────────────────────────
    // Would the counter see the single queries at all? A part that was NOT
    // preloaded must trigger both single paths — otherwise the
    // assertions above check nothing.
    seen.length = 0;
    count = true;
    await fc.resolveBlPartNumber('bwt-teil-gibtesnicht');
    count = false;
    assert.equal(
      howOften(/FROM bl_mapping WHERE type=\$1 AND rb_id=\$2/),
      1,
      'counter-check: the single query on bl_mapping was not counted',
    );
  } finally {
    db.pool.query = altQuery;
    await cleanUp();
    await db.pool.end().catch(() => {});
  }
});
