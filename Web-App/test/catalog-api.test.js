/**
 * Integration test for /api/v2/catalog against real PostgreSQL.
 * ONLY requireToken (auth) is stubbed — router, db module and SQL run
 * 1:1 as in production. Checks among other things the future-year edge case (only a few
 * sets in the maximum year), from-to ranges, theme inheritance and owned flags.
 *
 * Counter-checks: (05.11.2026) page_size not read in routes/api/catalog.ts
 * → red: “Pagination” (the page has 60 instead of 10 sets). (10.11.2026) in
 * src/catalog/repository/catalogSearch.ts c.image_local removed from SET_SPALTEN →
 * red: “the list names the local image …” (undefined instead of the address); there
 * `NOT ${PLATZHALTER}` removed from catalogWhere() → red: “… a placeholder is missing”
 * (total 1 instead of 0).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

process.env.DATABASE_URL = DB_URL;

// build .ts -> .js (esbuild, in place) — idempotent and fast
// Build to dist/ instead of in place — see helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');

// stub requireToken BEFORE the router is loaded
// The path must point to the BUILT module in dist/ — that is where the router loads
// its dependency, and only a hit in the same require cache entry
// replaces it effectively.
const { DIST, testData } = require('./helpers/sources');
const mwPath = require.resolve(path.join(DIST, 'routes/api', 'middleware.js'));
require.cache[mwPath] = /** @type {any} */ ({
  id: mwPath,
  filename: mwPath,
  loaded: true,
  exports: {
    guardFor: () => ({
      requireToken: (req, _res, next) => {
        req.apiUser = { user_id: 1 };
        next();
      },
    }),
  },
});

const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

/**
 * Restores the real schema that seed() replaces with dummies.
 */
async function restoreSchema() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
}

async function seed() {
  // First ensure the real schema, then put the dummies over it:
  // seed() needs `set_acquisitions` REAL (see below), and whether an earlier
  // run file already created it depends on the order.
  // An empty database gets its schema here; only afterwards the dummies.
  await db.initSchema();
  await db.run(`DROP TABLE IF EXISTS rb_sets, rb_themes, rb_inventories,
                                    rb_inventory_minifigs, sets CASCADE`);
  await db.run(`CREATE TABLE rb_sets (set_num TEXT PRIMARY KEY, name TEXT, year INTEGER, theme_id INTEGER, num_parts INTEGER, set_img_url TEXT,
                                     source TEXT NOT NULL DEFAULT 'csv')`);
  await db.run(`CREATE TABLE rb_themes (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER)`);
  await db.run(`CREATE TABLE rb_inventories (id INTEGER PRIMARY KEY, version INTEGER, set_num TEXT)`);
  await db.run(
    `CREATE TABLE rb_inventory_minifigs (id SERIAL PRIMARY KEY, inventory_id INTEGER, fig_num TEXT, quantity INTEGER)`,
  );
  // `sets` stays the only dummy. Since migration 0036 the set quantity
  // is in set_acquisitions, and the catalog list reads it from there
  // (owned_quantity via db/stockQuantity.ts) — with only `sets`
  // it answered 0 (measured: “expected 2, actual 0"). Columns like setBestand() in db/inventoryView.ts.
  await db.run(
    `CREATE TABLE sets (id SERIAL, user_id INTEGER, set_number TEXT, storage_id INTEGER, added_at TIMESTAMPTZ)`,
  );
  await db.run(
    `INSERT INTO rb_themes VALUES (1,'Star Wars',NULL),(2,'Ultimate Collector Series',1),(3,'Technic',NULL) ON CONFLICT DO NOTHING`,
  );
  let i = 0;
  for (let y = 2000; y <= 2026; y++)
    for (let k = 0; k < 3; k++)
      await db.run(`INSERT INTO rb_sets VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [
        `${1000 + i++}-1`,
        `Set ${y}-${k}`,
        y,
        k % 2 ? 3 : 2,
        100 + k,
        '',
      ]);
  for (let k = 0; k < 4; k++)
    await db.run(`INSERT INTO rb_sets VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [
      `${9000 + k}-1`,
      `Future Set ${k}`,
      2027,
      1,
      500 + k,
      '',
    ]);
  await db.run(`INSERT INTO rb_inventories VALUES (1, 1, '9000-1'), (2, 2, '9000-1') ON CONFLICT DO NOTHING`);
  await db.run(
    `INSERT INTO rb_inventory_minifigs (inventory_id, fig_num, quantity) VALUES (2,'fig-001',2),(2,'fig-002',1),(1,'fig-old',9) ON CONFLICT DO NOTHING`,
  );
  // The stock: account 1 holds 9000-1, two copies — the number
  // is in the entry.
  await db.run(`INSERT INTO users (id, username, password_hash)
                VALUES (1, 'katalogprobe', 'x') ON CONFLICT (id) DO NOTHING`);
  await db.run(`INSERT INTO sets (user_id, set_number) VALUES (1, '9000-1')`);
  await db.run(`DELETE FROM set_acquisitions WHERE user_id = 1 AND set_number = '9000-1'`);
  await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity)
                VALUES (1, '9000-1', 2)`);
}

test('catalog API (Postgres integration)', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t, DB_URL);
    return;
  }
  await seed();
  const app = express();
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/catalog.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}/api/v2`;
  const get = async p => {
    const r = await fetch(base + p);
    return { status: r.status, body: await r.json() };
  };

  await t.test('meta: year range, year_counts, theme inheritance', async () => {
    const r = await get('/catalog/meta');
    assert.equal(r.body.success, true);
    assert.equal(r.body.year_min, 2000);
    assert.equal(r.body.year_max, 2027);
    const yc27 = r.body.year_counts.find(y => y.year === 2027);
    assert.deepEqual(yc27, { year: 2027, n: 4 });
    const sw = r.body.themes.find(th => th.name === 'Star Wars');
    assert.ok(sw.set_count > 4, 'Star Wars muss UCS-Kinder mitzählen');
  });

  await t.test('edge case maximum year: from=to=2027 delivers the 4 sets', async () => {
    const r = await get('/catalog/sets?year_from=2027&year_to=2027&limit=60');
    assert.equal(r.body.total, 4);
    assert.equal(r.body.sets.length, 4);
  });

  await t.test('from-to ranges', async () => {
    let r = await get('/catalog/sets?year_from=2000&year_to=2005&limit=200');
    assert.equal(r.body.total, 18);
    assert.ok(r.body.sets.every(s => s.year >= 2000 && s.year <= 2005));
    r = await get('/catalog/sets?year_from=2025&limit=200');
    assert.equal(r.body.total, 10);
    r = await get('/catalog/sets?year_to=2001&limit=200');
    assert.equal(r.body.total, 6);
  });

  await t.test('search + owned flag', async () => {
    const r = await get('/catalog/sets?q=Future');
    assert.equal(r.body.total, 4);
    const owned = r.body.sets.find(s => s.set_number === '9000-1');
    assert.equal(owned.owned, true);
    assert.equal(owned.owned_quantity, 2);
  });

  await t.test('the list names the local image from set_catalog, a capture placeholder is missing', async () => {
    await db.run(`INSERT INTO set_catalog (set_number, image_local) VALUES ('9001-1', '/images/sets/9001-1.jpg')
                  ON CONFLICT (set_number) DO UPDATE SET image_local = EXCLUDED.image_local`);
    await db.run(
      `INSERT INTO rb_sets (set_num, name, source) VALUES ('9100-1', 'Set 9100-1', 'api') ON CONFLICT DO NOTHING`,
    );
    const r = await get('/catalog/sets?q=Future&limit=60');
    const bilder = Object.fromEntries(r.body.sets.map(s => [s.set_number, s.image_local]));
    assert.deepEqual(bilder, { '9000-1': null, '9001-1': '/images/sets/9001-1.jpg', '9002-1': null, '9003-1': null });
    assert.equal((await get('/catalog/sets?q=9100')).body.total, 0, 'ein Platzhalter fehlt in der Liste');
    assert.equal((await get('/catalog/sets/9100-1')).status, 404, 'und im Detail');
  });

  await t.test('theme filter incl. subthemes', async () => {
    const r = await get('/catalog/sets?theme_id=1&limit=200');
    assert.ok(r.body.total > 4);
    assert.ok(r.body.sets.every(s => s.theme_id === 1 || s.theme_id === 2));
  });

  await t.test('detail: minifigures from the newest inventory, normalization, 404', async () => {
    let r = await get('/catalog/sets/9000-1');
    assert.equal(r.body.set.minifigs, 3, 'nur Inventar v2 zählt');
    assert.equal(r.body.set.theme_name, 'Star Wars');
    r = await get('/catalog/sets/9000');
    assert.equal(r.body.success, true, 'Nummer ohne -1 wird normalisiert');
    r = await get('/catalog/sets/123456');
    assert.equal(r.status, 404);
  });

  await t.test('Pagination', async () => {
    const r = await get('/catalog/sets?limit=10&page=2&sort=num_asc');
    assert.equal(r.body.total, 85);
    assert.equal(r.body.page, 2);
    assert.equal(r.body.sets.length, 10);
    // page_size is the name for all lists; limit stays for older apps.
    const neu = await get('/catalog/sets?page_size=10&page=2&sort=num_asc');
    assert.deepEqual(
      neu.body.sets.map(s => s.set_number),
      r.body.sets.map(s => s.set_number),
    );
    assert.equal(neu.body.page_size, 10);
    assert.equal(neu.body.pages, 9);
  });

  srv.close();
  // ORDER: first the schema, then the pool
  await restoreSchema();
  await db.pool.end(); // close the pg pool, otherwise it keeps the process open
});
