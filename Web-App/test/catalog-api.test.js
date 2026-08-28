/**
 * Integrationstest für /api/v1/catalog gegen echtes PostgreSQL.
 * Gestubbt wird NUR requireToken (Auth) — Router, db-Modul und SQL laufen
 * 1:1 wie in Produktion. Prüft u.a. den Zukunftsjahr-Randfall (nur wenige
 * Sets im Maximaljahr), Von-Bis-Bereiche, Theme-Vererbung und owned-Flags.
 *
 * Voraussetzung: erreichbare Test-DB (Inhalt wird GELÖSCHT!), z.B.
 *   createdb cattest && psql -c "CREATE USER tester PASSWORD 'test'"
 * Verbindung via TEST_DATABASE_URL, Default:
 *   postgres://tester:test@localhost/cattest
 * Ohne erreichbare DB wird die Suite übersprungen (skip), nicht rot.
 *
 * Ausführen: npm run test:api   (baut vorher die .ts -> .js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

process.env.DATABASE_URL = DB_URL;
process.env.WEB_WORKERS = '1';

// .ts -> .js bauen (esbuild, in-place) — idempotent und schnell
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();

// requireToken stubben, BEVOR der Router geladen wird
// Der Pfad muss auf das GEBAUTE Modul in dist/ zeigen — dort lädt der Router
// seine Abhängigkeit, und nur ein Treffer im selben require-Cache-Eintrag
// ersetzt sie wirksam.
const { DIST } = require('./helpers/sources');
const mwPath = require.resolve(path.join(DIST, 'routes', 'api_v1', 'middleware.js'));
require.cache[mwPath] = {
  id: mwPath, filename: mwPath, loaded: true,
  exports: { requireToken: (req, _res, next) => { req.apiUser = { user_id: 1 }; next(); } },
};

const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

async function seed() {
  await db.run(`DROP TABLE IF EXISTS rb_sets, rb_themes, rb_inventories, rb_inventory_minifigs, sets CASCADE`);
  await db.run(`CREATE TABLE rb_sets (set_num TEXT PRIMARY KEY, name TEXT, year INTEGER, theme_id INTEGER, num_parts INTEGER, set_img_url TEXT)`);
  await db.run(`CREATE TABLE rb_themes (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER)`);
  await db.run(`CREATE TABLE rb_inventories (id INTEGER PRIMARY KEY, version INTEGER, set_num TEXT)`);
  await db.run(`CREATE TABLE rb_inventory_minifigs (id SERIAL PRIMARY KEY, inventory_id INTEGER, fig_num TEXT, quantity INTEGER)`);
  await db.run(`CREATE TABLE sets (user_id INTEGER, set_number TEXT, quantity INTEGER)`);
  await db.run(`INSERT INTO rb_themes VALUES (1,'Star Wars',NULL),(2,'Ultimate Collector Series',1),(3,'Technic',NULL) ON CONFLICT DO NOTHING`);
  let i = 0;
  for (let y = 2000; y <= 2026; y++)
    for (let k = 0; k < 3; k++)
      await db.run(`INSERT INTO rb_sets VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [`${1000 + i++}-1`, `Set ${y}-${k}`, y, (k % 2) ? 3 : 2, 100 + k, '']);
  for (let k = 0; k < 4; k++)
    await db.run(`INSERT INTO rb_sets VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [`${9000 + k}-1`, `Future Set ${k}`, 2027, 1, 500 + k, '']);
  await db.run(`INSERT INTO rb_inventories VALUES (1, 1, '9000-1'), (2, 2, '9000-1') ON CONFLICT DO NOTHING`);
  await db.run(`INSERT INTO rb_inventory_minifigs (inventory_id, fig_num, quantity) VALUES (2,'fig-001',2),(2,'fig-002',1),(1,'fig-old',9) ON CONFLICT DO NOTHING`);
  await db.run(`INSERT INTO sets VALUES (1, '9000-1', 2) ON CONFLICT DO NOTHING`);
}

test('Katalog-API (Postgres-Integration)', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    // REQUIRE_DB=1 (CI): Ein Überspringen ist hier KEIN akzeptabler Ausgang.
    // Vorher war die Suite in jeder Umgebung ohne Datenbank grün — also
    // ausgerechnet dort, wo niemand hinschaut. Wer die Datenbank erwartet,
    // bekommt jetzt einen Fehlschlag statt eines stillen Skips.
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar: ${DB_URL}`);
    }
    // REQUIRE_DB=1 (in CI gesetzt) verbietet das Überspringen.
    //
    // Ohne diese Sperre war die Suite in jeder Umgebung ohne Postgres GRÜN —
    // inklusive CI, falls der Service-Container mal nicht hochkommt. Genau
    // die Tests, die am meisten absichern, hätten dann stillschweigend nichts
    // geprüft. Lieber ein lauter Fehlschlag.
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.`);
    }
    t.skip(`Test-DB nicht erreichbar (${DB_URL}) — Suite übersprungen`);
    return;
  }
  await seed();
  const app = express();
  app.use('/api/v1', _req('routes/api_v1/catalog.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}/api/v1`;
  const get = async (p) => {
    const r = await fetch(base + p);
    return { status: r.status, body: await r.json() };
  };

  await t.test('meta: Jahresbereich, year_counts, Theme-Vererbung', async () => {
    const r = await get('/catalog/meta');
    assert.equal(r.body.success, true);
    assert.equal(r.body.year_min, 2000);
    assert.equal(r.body.year_max, 2027);
    const yc27 = r.body.year_counts.find(y => y.year === 2027);
    assert.deepEqual(yc27, { year: 2027, n: 4 });
    const sw = r.body.themes.find(th => th.name === 'Star Wars');
    assert.ok(sw.set_count > 4, 'Star Wars muss UCS-Kinder mitzählen');
  });

  await t.test('Randfall Maximaljahr: from=to=2027 liefert die 4 Sets', async () => {
    const r = await get('/catalog/sets?year_from=2027&year_to=2027&limit=60');
    assert.equal(r.body.total, 4);
    assert.equal(r.body.sets.length, 4);
  });

  await t.test('Von-Bis-Bereiche', async () => {
    let r = await get('/catalog/sets?year_from=2000&year_to=2005&limit=200');
    assert.equal(r.body.total, 18);
    assert.ok(r.body.sets.every(s => s.year >= 2000 && s.year <= 2005));
    r = await get('/catalog/sets?year_from=2025&limit=200');
    assert.equal(r.body.total, 10);
    r = await get('/catalog/sets?year_to=2001&limit=200');
    assert.equal(r.body.total, 6);
  });

  await t.test('Suche + owned-Flag', async () => {
    const r = await get('/catalog/sets?q=Future');
    assert.equal(r.body.total, 4);
    const owned = r.body.sets.find(s => s.set_number === '9000-1');
    assert.equal(owned.owned, true);
    assert.equal(owned.owned_quantity, 2);
  });

  await t.test('Theme-Filter inkl. Unterthemen', async () => {
    const r = await get('/catalog/sets?theme_id=1&limit=200');
    assert.ok(r.body.total > 4);
    assert.ok(r.body.sets.every(s => s.theme_id === 1 || s.theme_id === 2));
  });

  await t.test('Detail: Minifiguren aus neuestem Inventar, Normalisierung, 404', async () => {
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
  });

  srv.close();
  await db.pool.end();   // pg-Pool schließen, sonst hält er den Prozess offen
});
