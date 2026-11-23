/**
 * The trash can deletes the card that was clicked on.
 *
 * Counter-check: in routes/api/minifigs.ts DELETE ignores ?owner and takes the own account → red “the trash hits the clicked card, not the own one”.
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { holdsMinifig, holdsPart, subsetOf } = require('./helpers/inventory');

async function reachable() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// ONCE for the file, not per test: a t.after(() => db.pool.end()) in the
// first test closed the pool before the second one ran — which then reported
// „Test-DB nicht erreichbar" instead of checking. At file level it runs after
// the last test, even if an assertion fails before.
after(() => db.pool.end());

test('the trash hits the clicked card, not the own one', async t => {
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

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x'),('fremd','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const main = await id('haupt'),
    kind = await id('kind'),
    fremd = await id('fremd');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [main, kind]);

  // The same number for both — exactly the case the route could not
  // distinguish.
  await holdsPart(db, main, '3001', { quantity: 5, colorId: 4 });
  await holdsPart(db, kind, '3001', { quantity: 9, colorId: 4 });
  await holdsMinifig(db, main, 'sw0001', { quantity: 1 });
  await holdsMinifig(db, kind, 'sw0001', { quantity: 2 });

  const { base } = testServer(_req, { session: { userId: main, username: 'haupt' }, t });
  const callFn = async (path, method = 'GET') => {
    const r = await fetch(base + path, { method: method });
    return { status: r.status, body: await r.json() };
  };
  // Since migration 0038 the piece count comes from the acquisitions, not from
  // the column. subsetOf() carries the same case distinction as the
  // Server (test/helpers/inventory.js).
  const parts = async () => {
    const lines = await db.all(`SELECT user_id, color_id FROM parts WHERE part_number='3001' ORDER BY user_id`);
    const result = [];
    for (const r of lines) result.push(`${r.user_id}:${await subsetOf(db, r.user_id, '3001', r.color_id ?? 0)}`);
    return result;
  };
  const minifigs = async () =>
    (await db.all(`SELECT user_id FROM minifigs WHERE fig_number='sw0001' ORDER BY user_id`)).map(r => r.user_id);

  assert.deepEqual(await parts(), [`${main}:5`, `${kind}:9`], 'precondition');

  // Delete the CHILD's card.
  const a = await callFn(`/api/v2/parts/3001/4?owner=${kind}`, 'DELETE');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(
    await parts(),
    [`${main}:5`],
    "The sub-account's card was clicked — exactly that one must be gone, and the own one must stay",
  );

  // Then the own one, without parameter (behavior as before).
  const b = await callFn('/api/v2/parts/3001/4', 'DELETE');
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(await parts(), [], 'Without owner the own account');

  // The same for minifigures.
  assert.deepEqual(await minifigs(), [main, kind], 'minifigures precondition');
  const c = await callFn(`/api/v2/minifigs/sw0001?owner=${kind}`, 'DELETE');
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(await minifigs(), [main], "The sub-account's figure must be gone");

  // ── The same when CHANGING ────────────────────────────────────────────────
  // If the main account changes the quantity on the child's card, its OWN
  // row must not silently go along. Checking reading and deleting and leaving out writing
  // would mean leaving the same error standing at the third place.
  await holdsPart(db, main, '3020', { quantity: 5, colorId: 0 });
  await holdsPart(db, kind, '3020', { quantity: 9, colorId: 0 });
  // Like teile() above: since migration 0038 the piece count stands in the
  // acquisitions. The quantity control writes exactly there — hence this is
  // also the place where a grab at the wrong row becomes noticeable.
  const quantities = async () => {
    const lines = await db.all(`SELECT user_id, color_id FROM parts WHERE part_number='3020' ORDER BY user_id`);
    const result = [];
    for (const r of lines) result.push(`${r.user_id}:${await subsetOf(db, r.user_id, '3020', r.color_id ?? 0)}`);
    return result;
  };
  const put = async (path, quantity) =>
    (
      await fetch(base + path, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantity: quantity }),
      })
    ).status;

  assert.equal(await put(`/api/v2/parts/3020/0?owner=${kind}`, 99), 200);
  assert.deepEqual(
    await quantities(),
    [`${main}:5`, `${kind}:99`],
    "The sub-account's card must be changed — the own one stays",
  );
  assert.equal(
    await put(`/api/v2/parts/3020/0?owner=${fremd}`, 42),
    403,
    'An account outside the household is rejected',
  );
  assert.deepEqual(await quantities(), [`${main}:5`, `${kind}:99`], 'and nothing touched');

  // An account outside the household does not work — the parameter is a
  // statement of the view, not an access path.
  const d = await callFn(`/api/v2/minifigs/sw0001?owner=${fremd}`, 'DELETE');
  assert.equal(d.status, 403, 'A foreign account must be rejected, not silently ignored');
  assert.deepEqual(await minifigs(), [main], 'and touch nothing');
});

/**
 * For a view to be able to PASS the owner along, it must first GET it.
 */
test('both valuations carry the owner along', async t => {
  if (!(await reachable())) {
    noDb(t);
    return;
  }
  // NO second DROP SCHEMA: the first test in this file has already built the schema
  // fresh, and every further dropping is one more lock
  // that can collide with the connection pool of a test file that just
  // ended. The template here therefore uses its own names (h2, …
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

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('h2','x'),('k2','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const main = await id('h2'),
    kind = await id('k2');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [main, kind]);
  // Since migration 0035 the price stands in the acquisition, not on the
  // Bestandszeile.
  // Quantity AND price in one call: holdsPart/holdsMinifig create the acquisition
  // themselves. A second INSERT next to it would violate idx_part_acq_tag_zustand …
  await holdsPart(db, main, '3001', { quantity: 5, colorId: 4, price: 0.5 });
  await holdsPart(db, kind, '3020', { quantity: 9, colorId: 0, price: 0.3 });
  await holdsMinifig(db, main, 'sw0001', { quantity: 1, price: 12.0 });
  await holdsMinifig(db, kind, 'sw0002', { quantity: 2, price: 9.0 });

  const { base } = testServer(_req, { session: { userId: main, username: 'h2' }, t });
  const hole = async p => (await fetch(base + p)).json();

  // Both kinds in ONE loop: the assertion should read the same for both,
  // otherwise they drift apart again.
  for (const [path, field, kind] of [
    ['/api/v2/finance/parts-valuation', 'parts', 'Teile'],
    ['/api/v2/finance/minifigs-valuation', 'figs', 'Minifiguren'],
  ]) {
    const lines = (await hole(path))[field] || [];
    assert.equal(lines.length, 2, `${kind}: precondition has two entries`);
    for (const z of lines) {
      assert.ok(z.user_id, `${kind}: user_id missing — without it withOwnerNames() attaches nothing`);
      assert.equal(z.owners?.length, 1, `${kind}: exactly one owner badge expected`);
      assert.equal(z.owners[0].id, z.user_id, `${kind}: badge must match the owner`);
    }
  }
});
