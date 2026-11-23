/**
 * Paged lists on the server, on the routes against the database:
 * sort whitelist with fallback, bound search term, theme list over
 * the whole stock only on page 1, counter over groups, without page_size
 * everything. The UI behavior is checked by test/listen-paging-ui.test.js.
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted):
 *   A  in SET_SORTS qty_asc to `s.quantity DESC, …` → red: “by quantity …”
 *   B  fromTable(SET_SORTS, …) replaced by `SET_SORTS[sort] ?? …` → red:
 *      “unknown sorting …” (constructor delivers a function → 500)
 *   C  in readSets `themen: !!page_size && …` replaced by `themen: !!page_size` →
 *      red: “the theme list …” (page 2 carries themes)
 *   D  in the minifigure counter GROUP BY without m.source/LOWER(TRIM) replaced by
 *      `GROUP BY m.set_number, m.fig_number` → red: “minifigures count …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet, holdsMinifig, holdsPart, catalogSet } = require('./helpers/inventory');

// Five sets: quantity, theme and time added such that every sorting yields a different order.
const SETS = [
  { nr: '77101-1', name: 'Alpha', theme: 'Burg', quantity: 3, ago: 5 },
  { nr: '77102-1', name: "O'Brien 100%", theme: 'Stadt', quantity: 1, ago: 4 },
  { nr: '77103-1', name: 'Gamma', theme: 'Burg', quantity: 2, ago: 3 },
  { nr: '77104-1', name: 'Delta', theme: 'Weltraum', quantity: 1, ago: 2 },
  { nr: '77105-1', name: 'Epsilon', theme: 'Stadt', quantity: 3, ago: 1 },
];

test('page-by-page lists on the server', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `paging_${process.pid}`;
  const numbers = SETS.map(s => s.nr);
  const cleanUp = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.run('DELETE FROM set_minifigs WHERE set_number = ANY($1)', [numbers]);
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [numbers]);
  };
  await cleanUp();
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  for (const s of SETS) {
    await catalogSet(db, s.nr, { name: s.name, theme: s.theme });
    await holdsSet(db, uid, s.nr, s.quantity);
    await db.run(
      `UPDATE sets SET added_at = NOW() - make_interval(days => $3) WHERE user_id = $1 AND set_number = $2`,
      [uid, s.nr, s.ago],
    );
  }
  // The same minifigure in two sets and a second one: two groups.
  await holdsMinifig(db, uid, 'fig-0001', { setNumber: '77101-1' });
  await holdsMinifig(db, uid, 'FIG-0001 ', { setNumber: '77103-1' });
  await holdsMinifig(db, uid, 'fig-0002', { setNumber: '77104-1' });
  for (const nr of ['91001', '91002', '91003']) await holdsPart(db, uid, nr);
  t.after(async () => {
    await cleanUp().catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { session: { userId: uid }, t });
  const hole = async path => {
    const r = await fetch(`${base}/api/v2${path}`);
    const b = await r.json();
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(b)}`);
    return b;
  };
  const sequence = async query => (await hole(`/sets?${query}`)).sets.map(s => s.name[0]);

  await t.test('sorting by quantity works in both directions, ties by addition', async () => {
    assert.deepEqual(await sequence('sort=qty_desc'), ['E', 'A', 'G', 'D', 'O']);
    assert.deepEqual(await sequence('sort=qty_asc'), ['D', 'O', 'G', 'E', 'A']);
  });

  await t.test('an unknown sorting falls back to "most recently added"', async () => {
    const preset = ['E', 'D', 'G', 'O', 'A'];
    assert.deepEqual(await sequence('sort=added_desc'), preset);
    for (const s of ['constructor', '__proto__', 'toString', 'name_asc;DROP TABLE sets', 'x'])
      assert.deepEqual(await sequence(`sort=${encodeURIComponent(s)}`), preset, s);
  });

  await t.test('the search term is bound, not inserted', async () => {
    assert.deepEqual(await sequence(`search=${encodeURIComponent("o'brien")}`), ['O']);
    assert.deepEqual(await sequence(`search=${encodeURIComponent("' OR 1=1 --")}`), []);
  });

  await t.test('without page_size everything, with page_size pages and total', async () => {
    const all = await hole('/sets');
    assert.equal(all.sets.length, 5);
    assert.equal(all.themes, undefined, 'no theme list without page_size');
    const s1 = await hole('/sets?page=1&page_size=2&sort=num_asc');
    const s3 = await hole('/sets?page=3&page_size=2&sort=num_asc');
    assert.deepEqual([s1.sets.map(s => s.set_number), s1.total], [['77101-1', '77102-1'], 5]);
    assert.deepEqual([s3.sets.map(s => s.set_number), s3.total], [['77105-1'], 5]);
  });

  await t.test('the theme list comes over the whole inventory and only on page 1', async () => {
    const s1 = await hole('/sets?page=1&page_size=1&sort=num_asc');
    assert.deepEqual([...s1.themes].sort(), ['Burg', 'Stadt', 'Weltraum'], 'Themes of the other pages are missing');
    const s2 = await hole('/sets?page=2&page_size=1&sort=num_asc');
    assert.ok(!s2.themes?.length, `Follow-up page carries themes: ${s2.themes}`);
  });

  await t.test('minifigures count per figure, not per set, and load page by page', async () => {
    const all = await hole('/minifigs');
    assert.equal(all.figs.length, 2, JSON.stringify(all.figs.map(f => f.fig_number)));
    const s1 = await hole('/minifigs?page=1&page_size=1');
    const s2 = await hole('/minifigs?page=2&page_size=1');
    assert.deepEqual([s1.figs.length, s1.total, s2.figs.length, s2.total], [1, 2, 1, 2]);
    assert.notEqual(s1.figs[0].fig_number.toLowerCase().trim(), s2.figs[0].fig_number.toLowerCase().trim());
  });

  await t.test('the manual parts load page by page too', async () => {
    const s1 = await hole('/parts/manual?page=1&page_size=2');
    const s2 = await hole('/parts/manual?page=2&page_size=2');
    assert.equal(s1.parts.length, 2);
    assert.equal(s2.parts.length, 1);
    assert.deepEqual([...s1.parts, ...s2.parts].map(p => p.part_number).sort(), ['91001', '91002', '91003']);
  });
});
