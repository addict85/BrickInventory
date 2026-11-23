/**
 * The parts list delivers the REBRICKABLE number, not the BrickLink number.
 *
 * Counter-check (carried out): `part_number: p.part_number` set back to
 * `blId` → step 1 turns red; additionally the key turned back to
 * `${blId}|…` → step 2 turns red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { portOf } = require('./helpers/server');
const db = testData();

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  await db.run(`INSERT INTO users (username, password_hash) VALUES ('bauer','x')`);

  await db.run(`INSERT INTO rb_inventories (id, set_num, version) VALUES (900,'60052-1',2)`);
  // Three rows that describe the case completely:
  //   3070b → BrickLink 3070   (the renaming on which it failed)
  //   3069b → BrickLink 3070   (second Rebrickable number, SAME BL number)
  //   3001  → no mapping       (BrickLink number = Rebrickable number)
  await db.run(`INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                VALUES (900,'3070b',0,4,false), (900,'3069b',0,2,false), (900,'3001',0,7,false)`);
  await db.run(`INSERT INTO rb_parts (part_num, name) VALUES
                ('3070b','Tile 1x1'), ('3069b','Tile 1x2'), ('3001','Brick 2x4')`);
  // Since migration 0037 in bl_mapping, with a kind distinction.
  await db.run(`INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES
                ('part','3070b','3070'), ('part','3069b','3070')`);
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('the parts list names the parts with both numbers', { concurrency: 1 }, async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await seed();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    /** @type {any} */ (req).session = { userId: 1 };
    /** @type {any} */ (req).apiUser = { user_id: 1, is_admin: 0 };
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  const srv = app.listen(0);
  t.after(async () => {
    srv.close();
    await db.pool.end().catch(() => {});
  });

  const r = await fetch(`http://127.0.0.1:${portOf(srv)}/api/v2/sets/60052-1/parts-list`);
  const d = await r.json();
  assert.equal(d.success, true, JSON.stringify(d));
  const nach = nr => d.parts.find(p => p.part_number === nr);

  await t.test('`part_number` is the Rebrickable number', () => {
    assert.ok(
      nach('3070b'),
      'The response does not know `3070b`. If it shows the BrickLink number 3070, ' +
        'the stock comparison looks in `parts` for a number that does not ' +
        "exist there — exactly Marco's „Teile fehlen“.\n" +
        'Returned was: ' +
        d.parts.map(p => p.part_number).join(', '),
    );
    assert.equal(
      nach('3070b').bl_part_number,
      '3070',
      'The BrickLink number must stay next to it — display and export depend on it',
    );
  });

  await t.test('two Rebrickable parts with ONE BrickLink number stay two rows', () => {
    // The reason why the key had to move along: on the
    // BrickLink number 3070b and 3069b would merge into one row — with
    // added-up demand (6) under one of the two numbers.
    assert.ok(nach('3069b'), 'The second number was swallowed');
    assert.equal(nach('3070b').total_quantity, 4, 'The demand for 3070b is no longer right');
    assert.equal(nach('3069b').total_quantity, 2, 'The demand for 3069b is no longer right');
    assert.equal(
      nach('3069b').bl_part_number,
      '3070',
      'Both carry the same BrickLink number — the export merges them there again',
    );
  });

  await t.test('without a mapping the number stays as it is', () => {
    // The opposite direction: where there is no BrickLink number, nothing may
    // be invented — both fields then carry the Rebrickable number.
    assert.ok(nach('3001'), '3001 is missing entirely');
    assert.equal(nach('3001').bl_part_number, '3001');
  });
});
