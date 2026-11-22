/**
 * Marco's star applies also where no form stands.
 *
 * ── Counter-checks (MEASURED on 20.10., numbers copied) ──────────────────
 *
 * Starting point: `# pass 8 / # fail 0` (seven cases and their wrapper).
 *
 *   A  the three create wrappers reset to normalizeLocation()
 *      (i.e. the state of Marco's finding)
 *      → `pass 5 / fail 3`. TWO cases are red: “a part without a place
 *        gets the default” (`null instead of 'Kiste 7'` — Marco's finding in
 *        numbers) and “a figure without a place gets it too”.
 *
 *        “a set would get it as well” stays GREEN, and that
 *        is no negligence but the boundary of this case: it checks
 *        locationForNewEntry() directly, because the path through addSet() has no
 *        Rebrickable here. So it says something about the value, not about
 *        addSet fetching it. Whoever changes the wrapper there does NOT notice it
 *        with this check — proven right here.
 *   B  in locationForNewEntry() the line `if (given !== undefined …)`
 *      removed (i.e. an empty field again treated like silence)
 *      → `pass 6 / fail 2`. Red: “an explicitly cleared field stays
 *        empty”. That is the half that makes the star usable in the first place.
 *   C  `defaultOf` replaced by a version without the JOIN on storage_locations
 *      (only the number from the settings)
 *      → `pass 6 / fail 2`. Red: “a default whose place was deleted
 *        does not apply”. The healing lies in the JOIN, not here.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

// Set up Rebrickable (testSources): without a name in the body addManualPart/addManualMinifig asks
// the catalog and then, if needed, Rebrickable. This is about the storage location,
// not about the name — the fetch should not reach over the network.
testSources(null, {
  lookupPart: async () => null,
  getMinifigInfo: async () => null,
});

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('the storage location default applies to every new capture', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  const UID = (await db.get(`INSERT INTO users (username,password_hash) VALUES ('marco','x') RETURNING id`)).id;
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES
                  ('3001','Brick 2 x 4'), ('3002','Brick 2 x 2'), ('3003','Brick 2 x 3'),
                  ('3004','Brick 1 x 2')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,image_url) VALUES
                  ('3001',4,'https://cdn.example/a.jpg'), ('3002',4,'https://cdn.example/b.jpg'),
                  ('3003',4,'https://cdn.example/c.jpg'), ('3004',4,'https://cdn.example/d.jpg')`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name,image_url) VALUES
                  ('fig-000123','Chewbacca','https://cdn.example/e.jpg')`);
  await db.run(`INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 7'), ($1,'Kiste 3')`, [UID]);
  const ortId = async name =>
    (await db.get('SELECT id FROM storage_locations WHERE user_id=$1 AND name=$2', [UID, name])).id;

  const holding = require('./helpers/sources').testArea('inventory');
  const { setDefault, locationForNewEntry } = {
    ..._req('src/inventory/storageLocation.js'),
    ...holding.locationService,
    setDefault: holding.setDefault,
  };
  const { addManualPart } = _req('src/parts/manualParts.js');
  const { addManualMinifig } = _req('src/minifigs/manualMinifigs.js');

  await setDefault(UID, await ortId('Kiste 7'));

  const locationOfPart = async nr =>
    (
      await db.get(
        `SELECT l.name FROM parts p LEFT JOIN storage_locations l ON l.id = p.storage_id
      WHERE p.user_id=$1 AND p.part_number=$2`,
        [UID, nr],
      )
    )?.name ?? null;

  await t.test('a part without a place gets the default', async () => {
    // Exactly like this the wanted import calls (routes/api/wanted.ts, `creator`):
    // number, color, quantity, condition — no storage.
    await addManualPart(UID, { part_number: '3001', color_id: 4, quantity: 1 });
    assert.equal(await locationOfPart('3001'), 'Kiste 7');
  });

  await t.test('a figure without a place gets it too', async () => {
    await addManualMinifig(UID, { fig_number: 'fig-000123', quantity: 1 });
    const z = await db.get(
      `SELECT l.name FROM minifigs m LEFT JOIN storage_locations l ON l.id = m.storage_id
        WHERE m.user_id=$1 AND m.fig_number='fig-000123'`,
      [UID],
    );
    assert.equal(z?.name ?? null, 'Kiste 7');
  });

  await t.test('a set would get it as well', async () => {
    // Not through addSet — see the header. What is checked is the value that
    // the wrapper in src/sets/service.ts gets from the same call.
    assert.equal(await locationForNewEntry(UID, undefined), 'Kiste 7');
    assert.equal(
      await locationForNewEntry(UID, null),
      'Kiste 7',
      'null comes from a missing default value of the signature and means ' +
        'the same as undefined: nobody said anything',
    );
  });

  await t.test('a place passed along wins against the default', async () => {
    await addManualPart(UID, { part_number: '3002', color_id: 4, quantity: 1, storage: 'Kiste 3' });
    assert.equal(await locationOfPart('3002'), 'Kiste 3');
  });

  await t.test('an explicitly cleared field stays empty', async () => {
    await addManualPart(UID, { part_number: '3003', color_id: 4, quantity: 1, storage: '' });
    assert.equal(
      await locationOfPart('3003'),
      null,
      'A form sends this when the prefilled default was cleared away ' +
        '(selectedStorage in „sammlung.js“). Putting it back would be ' +
        'a location nobody can get rid of',
    );
  });

  await t.test('a default whose place was deleted does not apply', async () => {
    await db.run('DELETE FROM storage_locations WHERE user_id=$1 AND name=$2', [UID, 'Kiste 7']);
    assert.equal(
      await locationForNewEntry(UID, undefined),
      null,
      'defaultOf() reads via a JOIN on the stock — the default heals itself',
    );
    await addManualPart(UID, { part_number: '3004', color_id: 4, quantity: 1 });
    assert.equal(await locationOfPart('3004'), null);
  });

  await t.test('without any default the old behavior stays', async () => {
    await setDefault(UID, null);
    assert.equal(await locationForNewEntry(UID, undefined), null);
    assert.equal(await locationForNewEntry(UID, 'Kiste 3'), 'Kiste 3');
  });
});
