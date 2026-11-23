/**
 * The number above the gallery must match what stands below it.
 *
 * Counter-check: in src/inventory/repository/metrics.ts total_quantity counts distinct set numbers → red “header and gallery count the same sets”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

async function reachable() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

after(() => db.pool.end());

test('header and gallery count the same sets', async t => {
  if (!(await reachable())) {
    noDb(t);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();
  // And the MIGRATIONS, not only the schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const main = await id('haupt'),
    kind = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [main, kind]);

  // BOTH own 75192-1 — without this overlap row count and
  // tile count match by chance, and the test checked nothing.
  await holdsSet(db, main, '75192-1', 1);
  await holdsSet(db, kind, '75192-1', 1);
  await holdsSet(db, kind, '21318-1', 1);

  const { scopeIds } = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const { getStats } = _req('src/inventory/metrics.js');
  const { readSets } = require('./helpers/sources').areaPage('sets');

  for (const mode of ['all', 'own']) {
    const uids = await scopeIds(main, mode);
    const head = await getStats(uids);
    const list = await readSets(uids, { page_size: 60 });
    assert.equal(
      head.total_sets,
      list.total,
      `scope ${mode}: the header names ${head.total_sets} sets, the gallery ` +
        `shows ${list.total}. Both numbers are on top of each other on the same ` +
        `screen — if one counts table rows and the other the tiles, ` +
        `they contradict each other in the household.`,
    );
    assert.equal(
      head.total_sets,
      (list.sets || []).length,
      `scope ${mode}: total matches, but the number of tiles does not`,
    );
  }

  // The other reading is preserved and stands in the app as its own tile
  // next to it („Einheiten"). Without this assertion the obvious
  // „correction" — both on DISTINCT — would have gone unnoticed.
  const all = await getStats(await scopeIds(main, 'all'));
  assert.equal(all.total_quantity, 3, 'copies still count individually: two accounts with the same set plus one');
  assert.equal(all.total_sets, 2, 'distinct sets in the household');
});
