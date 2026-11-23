/**
 * Where a client draws an owner badge, the response must carry it.
 *
 * Counter-check: attachOwners() (src/household/household.ts) returns rows with user_id without owners → red “every list with a badge in the client carries it in the response too”.
 * Counter-check (22.11.2026): attachOwners() without `uids.length < 2` → red “in a single account there is no badge” (manual lists).
 */
require('./helpers/system-frame');
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');
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

test('every list with a badge in the client carries it in the response too', async t => {
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

  // ONLY the sub-account owns something. That makes the badge meaningful:
  // if the own account stands there, the assignment is wrong; if it is missing,
  // the main account sees stock without an origin.
  await holdsSet(db, kind, '75192-1', 1);
  await holdsPart(db, kind, '3001', { setNumber: '75192-1', quantity: 10, colorId: 4 });
  await holdsPart(db, kind, '3020', { quantity: 3, colorId: 0 });
  await holdsMinifig(db, kind, 'sw0001', { setNumber: '75192-1', quantity: 1 });
  await holdsMinifig(db, kind, 'sw0002', { quantity: 2 });

  const { scopeIds } = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const uids = await scopeIds(main, 'all');
  const S = require('./helpers/sources').areaPage('sets');
  const P = _req('src/parts/queries.js');
  const M = _req('src/minifigs/queries.js');

  /** @type {[string, () => Promise<any[]>][]} */
  const listen = [
    ['/v2/sets', async () => (await S.readSets(uids, { page_size: 60 })).sets],
    // manualPartsList/readManualMinifigs deliver a BARE array; the route
    // wraps it. The three other lists deliver an object with `total`.
    ['/v2/parts/manual', async () => await P.manualPartsList(uids, {})],
    ['/v2/minifigs', async () => (await M.readMinifigs(uids, { source: 'set' })).figs],
    ['/v2/minifigs/manual', async () => await M.readManualMinifigs(uids, {})],
  ];

  for (const [name, hole] of listen) {
    const lines = await hole();
    assert.ok(lines?.length, `${name}: precondition returns no row — then the rest checks nothing`);
    for (const z of lines) {
      assert.ok(
        Array.isArray(z.owners) && z.owners.length === 1,
        `${name}: no owner badge in the response. Both clients draw it ` +
          `at this place (ownerBadges / OwnerBadges) — without the value it stays empty.`,
      );
      assert.equal(z.owners[0].id, kind, `${name}: wrong account in the badge`);
      assert.equal(z.owners[0].username, 'kind', `${name}: a badge without a name is useless`);
    }
  }

  // The set parts list is the one exception, and a justified one: it groups
  // by part number AND color across the whole household, and neither of the two
  // clients draws a badge there. If one is added, this assertion
  // strikes — then the aggregate belongs in the query too.
  const parts = (await P.partsQuery(uids, { page_size: 60, exclude_manual: '1' })).parts;
  assert.ok(parts?.length, 'precondition: set parts are missing');
  for (const z of parts) {
    assert.equal(
      z.owners,
      undefined,
      'The set parts list now carries owners — then a client must also ' +
        'draw them, otherwise it is ballast in every response.',
    );
  }
});

test('in a single account there is no badge', async t => {
  if (!(await reachable())) {
    noDb(t);
    return;
  }
  // No second DROP SCHEMA — own account names suffice (see
  // manual-delete-owner-db.test.js).
  await db.initSchemaOnce();
  // Migrations here too — see the reasoning further above.
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('allein','x')`);
  const alone = (await db.get(`SELECT id FROM users WHERE username='allein'`)).id;
  await holdsSet(db, alone, '21318-1', 1);
  await holdsMinifig(db, alone, 'sw0003', { setNumber: '21318-1', quantity: 1 });
  await holdsPart(db, alone, '3021', { quantity: 2, colorId: 0 });
  await holdsMinifig(db, alone, 'sw0004', { quantity: 1 });

  const { scopeIds } = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const uids = await scopeIds(alone, 'all');
  const S = require('./helpers/sources').areaPage('sets');
  const M = _req('src/minifigs/queries.js');
  const P = _req('src/parts/queries.js');

  // „mine" on every tile would only be noise — and additional fields in
  // every response. The same decision as for the sets all along.
  for (const [name, lines] of [
    ['/v2/sets', (await S.readSets(uids, { page_size: 60 })).sets],
    ['/v2/minifigs', (await M.readMinifigs(uids, { source: 'set' })).figs],
    ['/v2/parts/manual', await P.manualPartsList(uids, alone)],
    ['/v2/minifigs/manual', await M.readManualMinifigs(uids, alone)],
  ]) {
    assert.ok(lines?.length, `${name}: precondition returns no row`);
    for (const z of lines) {
      assert.equal(z.owners, undefined, `${name}: a badge does not belong in a single account`);
      assert.equal(z.owner_ids, undefined, `${name}: owner_ids does not belong in a single account`);
    }
  }
});
