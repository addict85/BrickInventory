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
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { holdsMinifig, holdsPart, subsetOf } = require('./helpers/inventory');

async function erreichbar() {
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
  if (!(await erreichbar())) {
    keineDb(t);
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
  const haupt = await id('haupt'),
    kind = await id('kind'),
    fremd = await id('fremd');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  // The same number for both — exactly the case the route could not
  // distinguish.
  await holdsPart(db, haupt, '3001', { quantity: 5, colorId: 4 });
  await holdsPart(db, kind, '3001', { quantity: 9, colorId: 4 });
  await holdsMinifig(db, haupt, 'sw0001', { quantity: 1 });
  await holdsMinifig(db, kind, 'sw0001', { quantity: 2 });

  const { base } = testServer(_req, { sitzung: { userId: haupt, username: 'haupt' }, t });
  const ruf = async (path, methode = 'GET') => {
    const r = await fetch(base + path, { method: methode });
    return { status: r.status, body: await r.json() };
  };
  // Since migration 0038 the piece count comes from the acquisitions, not from
  // the column. subsetOf() carries the same case distinction as the
  // Server (test/helpers/inventory.js).
  const parts = async () => {
    const zeilen = await db.all(`SELECT user_id, color_id FROM parts WHERE part_number='3001' ORDER BY user_id`);
    const raus = [];
    for (const r of zeilen) raus.push(`${r.user_id}:${await subsetOf(db, r.user_id, '3001', r.color_id ?? 0)}`);
    return raus;
  };
  const minifigs = async () =>
    (await db.all(`SELECT user_id FROM minifigs WHERE fig_number='sw0001' ORDER BY user_id`)).map(r => r.user_id);

  assert.deepEqual(await parts(), [`${haupt}:5`, `${kind}:9`], 'Vorlage');

  // Delete the CHILD's card.
  const a = await ruf(`/api/v2/parts/3001/4?owner=${kind}`, 'DELETE');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(
    await parts(),
    [`${haupt}:5`],
    'Geklickt war die Karte des Unterkontos — genau die muss weg sein, und die eigene bleiben',
  );

  // Then the own one, without parameter (behavior as before).
  const b = await ruf('/api/v2/parts/3001/4', 'DELETE');
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(await parts(), [], 'Ohne owner das eigene Konto');

  // The same for minifigures.
  assert.deepEqual(await minifigs(), [haupt, kind], 'Vorlage Minifiguren');
  const c = await ruf(`/api/v2/minifigs/sw0001?owner=${kind}`, 'DELETE');
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(await minifigs(), [haupt], 'Die Figur des Unterkontos muss weg sein');

  // ── The same when CHANGING ────────────────────────────────────────────────
  // If the main account changes the quantity on the child's card, its OWN
  // row must not silently go along. Checking reading and deleting and leaving out writing
  // would mean leaving the same error standing at the third place.
  await holdsPart(db, haupt, '3020', { quantity: 5, colorId: 0 });
  await holdsPart(db, kind, '3020', { quantity: 9, colorId: 0 });
  // Like teile() above: since migration 0038 the piece count stands in the
  // acquisitions. The quantity control writes exactly there — hence this is
  // also the place where a grab at the wrong row becomes noticeable.
  const mengen = async () => {
    const zeilen = await db.all(`SELECT user_id, color_id FROM parts WHERE part_number='3020' ORDER BY user_id`);
    const raus = [];
    for (const r of zeilen) raus.push(`${r.user_id}:${await subsetOf(db, r.user_id, '3020', r.color_id ?? 0)}`);
    return raus;
  };
  const setze = async (path, quantity) =>
    (
      await fetch(base + path, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantity: quantity }),
      })
    ).status;

  assert.equal(await setze(`/api/v2/parts/3020/0?owner=${kind}`, 99), 200);
  assert.deepEqual(
    await mengen(),
    [`${haupt}:5`, `${kind}:99`],
    'Geändert werden muss die Karte des Unterkontos — die eigene bleibt',
  );
  assert.equal(
    await setze(`/api/v2/parts/3020/0?owner=${fremd}`, 42),
    403,
    'Ein Konto ausserhalb des Haushalts wird abgelehnt',
  );
  assert.deepEqual(await mengen(), [`${haupt}:5`, `${kind}:99`], 'und nichts angefasst');

  // An account outside the household does not work — the parameter is a
  // statement of the view, not an access path.
  const d = await ruf(`/api/v2/minifigs/sw0001?owner=${fremd}`, 'DELETE');
  assert.equal(d.status, 403, 'Fremdes Konto muss abgelehnt werden, nicht stillschweigend ignoriert');
  assert.deepEqual(await minifigs(), [haupt], 'und nichts anfassen');
});

/**
 * For a view to be able to PASS the owner along, it must first GET it.
 */
test('both valuations carry the owner along', async t => {
  if (!(await erreichbar())) {
    keineDb(t);
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
  const haupt = await id('h2'),
    kind = await id('k2');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);
  // Since migration 0035 the price stands in the acquisition, not on the
  // Bestandszeile.
  // Quantity AND price in one call: holdsPart/holdsMinifig create the acquisition
  // themselves. A second INSERT next to it would violate idx_part_acq_tag_zustand …
  await holdsPart(db, haupt, '3001', { quantity: 5, colorId: 4, preis: 0.5 });
  await holdsPart(db, kind, '3020', { quantity: 9, colorId: 0, preis: 0.3 });
  await holdsMinifig(db, haupt, 'sw0001', { quantity: 1, preis: 12.0 });
  await holdsMinifig(db, kind, 'sw0002', { quantity: 2, preis: 9.0 });

  const { base } = testServer(_req, { sitzung: { userId: haupt, username: 'h2' }, t });
  const hole = async p => (await fetch(base + p)).json();

  // Both kinds in ONE loop: the assertion should read the same for both,
  // otherwise they drift apart again.
  for (const [path, field, kind] of [
    ['/api/v2/finance/parts-valuation', 'parts', 'Teile'],
    ['/api/v2/finance/minifigs-valuation', 'figs', 'Minifiguren'],
  ]) {
    const zeilen = (await hole(path))[field] || [];
    assert.equal(zeilen.length, 2, `${kind}: Vorlage hat zwei Einträge`);
    for (const z of zeilen) {
      assert.ok(z.user_id, `${kind}: user_id fehlt — ohne das hängt withOwnerNames() nichts an`);
      assert.equal(z.owners?.length, 1, `${kind}: genau eine Besitzer-Plakette erwartet`);
      assert.equal(z.owners[0].id, z.user_id, `${kind}: Plakette muss zum Besitzer passen`);
    }
  }
});
