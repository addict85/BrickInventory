/**
 * A sets area with its own access (buildServices(zweite, …)) only reads and writes
 * there, also via household, settings, storage location, price alert, trash, catalog (inventory),
 * finances (fetchPrice, priceHistorySet) and jobs. The access of the process counts along and
 * must see no query. The household memory applies per access, not per account ID.
 *
 * Counter-checks (measured 11.11.2026, each on its own):
 *   A  currencyOf() in src/sets/service.ts again via getSetting(uid, …) →
 *      red: “currency from the second database”, “price alert …” (currency of the
 *      alert) and “the process access stayed untouched”
 *   B  deleteSetFor() in src/sets/delete.ts with
 *      haushaltBereich().writeScope(s.nutzer) → red: “the
 *      process access stayed untouched”
 *   C  setLocationOfSets() again via bestandBereich().locationService →
 *      red: “storage location in the second database” and “the process access …”
 *
 * Counter-checks (measured 11.11.2026, each on its own):
 *   D  setPrice() in src/sets/prices.ts calls fetchPrice() without the access of the
 *      sets → red: “market price from the cache of the second database” and “the
 *      process access …”
 *   E  setPriceHistory() calls priceHistorySet() without sk.finances → red:
 *      “price history from the second database” and “the process access …”
 *   F  partListOfSets() calls newestInventory(setNum) without sk.katalog → red:
 *      “parts list from the catalog …” and “the process access …”
 *   G  the same placeJobOne('images', …) without sk.auftraege → red:
 *      “parts list … image job there” (no job in the second one) and “the
 *      process access …”
 *   H  src/household/household.ts again with one memory for all accesses →
 *      red: “household memory per access” (14.11.2026 again, the memory now in the
 *      compartment of the area: gedaechtnis() with one compartment for all → red, the same test)
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { testName, cleanRemainder, id } = require('./helpers/test-names');
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const sources = require('./helpers/sources');
const _req = sources.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { createDb } = _req('db/database.js');

const NAME = testName('sets_zweite');
const SN = '99877-1';

/** Counts every query that goes via the access or its pool. */
function zaehle(zugang) {
  const n = { requests: 0 };
  const pool = zugang.pool;
  const echt = { query: pool.query.bind(pool), connect: pool.connect.bind(pool) };
  pool.query = (...a) => {
    n.requests++;
    return echt.query(...a);
  };
  pool.connect = (...a) => {
    n.requests++;
    return echt.connect(...a);
  };
  n.back = () => Object.assign(pool, echt);
  return n;
}

test('sets with a second access', { concurrency: 1, timeout: 180_000 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const admin = new Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await cleanRemainder(admin, 'sets_zweite');
  await admin.query(`CREATE DATABASE ${id(NAME)}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + NAME;
  const zweite = createDb({ connection: { connectionString: url.toString() }, pool: { max: 4 } });
  t.after(async () => {
    await zweite.notification.close();
    await zweite.pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
    sources.buildAndRequire();
    await db.pool.end().catch(() => {});
  });
  await zweite.initSchemaOnce();

  const { id: uid } = await zweite.get(
    "INSERT INTO users (username, password_hash) VALUES ('nur_in_zwei', 'x') RETURNING id",
  );
  await zweite.run("INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')", [uid]);
  await zweite.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, SN]);
  for (const condition of ['N', 'U'])
    await zweite.run(
      `INSERT INTO price_cache (set_number, condition, currency_code, min_price, avg_price, max_price, qty_avg_price, total_quantity, fetched_at)
       VALUES ($1, $2, 'CHF', 40, 42.5, 45, 42.5, 7, NOW())`,
      [SN, condition],
    );
  await zweite.run(
    `INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, min_price, max_price)
     VALUES ($1, 'N', 'CHF', 41, 41, 39, 43)`,
    [SN],
  );
  await zweite.run('INSERT INTO rb_inventories (id, set_num, version) VALUES (77, $1, 1)', [SN]);
  await zweite.run(
    `INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare) VALUES (77, '3001', 0, 4, false)`,
  );

  // Like the server (startup/wiring.ts), only via the second access.
  const { buildServices } = _req('startup/wiring.js');
  // Services without a key for it call the modules via the context of this access.
  const contexts = {};
  const alle = buildServices(zweite, { contexts });
  const sets = alle.sets;
  const prozess = zaehle(sources.testAccess());
  t.after(() => prozess.back());

  await t.test('currency from the second database', async () => {
    assert.equal(await require(path.join(ROOT, 'dist/src/sets/prices.js')).currencyOf(contexts.sets, uid), 'CHF');
  });

  await t.test('storage location in the second database', async () => {
    const { location, n } = await sets.setLocationOfSets(uid, SN, 'Kiste Z');
    assert.equal(location, 'Kiste Z');
    assert.equal(n, 1);
    const { locations } = await sets.locationsWithDefault(uid, undefined);
    assert.ok(
      locations.some(o => o.name === 'Kiste Z' || o === 'Kiste Z'),
      JSON.stringify(locations),
    );
  });

  await t.test('price alert in the second database', async () => {
    const alarm = await sets.setAlarmOfSets(uid, SN, { direction: 'below', threshold: 12.5, condition: 'N' });
    assert.equal(alarm.currency_code, 'CHF', "the alert's currency comes from the second database");
    assert.equal((await sets.readSetAlerts(uid, SN)).length, 1);
    assert.equal(await sets.deleteAlarmOfSets(uid, SN, 'N'), 1);
  });

  await t.test('market price from the cache of the second database', async () => {
    const p = await sets.setPrice(uid, { user: uid }, SN);
    assert.equal(p.error, undefined, JSON.stringify(p));
    assert.equal(Number(p.avg_price), 42.5);
    assert.equal(p.from_cache, true);
    assert.equal(p.currency, 'CHF');
  });

  await t.test('price history from the second database', async () => {
    const v = await sets.setPriceHistory(uid, { user: uid }, SN);
    assert.equal(Number(v.current.N?.avg_price), 42.5);
    assert.deepEqual(
      v.history_new.map(p => Number(p.avg_price)),
      [41],
    );
  });

  await t.test('parts list from the catalog of the second database, image job there', async () => {
    const r = await require(path.join(ROOT, 'dist/src/sets/content.js')).partListOfSets(
      contexts.sets,
      SN,
      async () => {},
    );
    assert.equal(r.source, 'db');
    assert.deepEqual(
      r.parts.map(p => [p.part_number, p.total_quantity]),
      [['3001', 4]],
    );
    const { n } = await zweite.get(
      "SELECT count(*)::int AS n FROM jobs WHERE type = 'images' AND payload->>'set_number' = $1",
      [SN],
    );
    assert.equal(n, 1, 'the image job is in the second database');
  });

  await t.test('deleting via household and trash of the second database', async () => {
    const trash = await sets.deleteSetFor({ user: uid }, SN);
    assert.equal(trash.length, 1);
    assert.equal((await zweite.get('SELECT count(*)::int AS n FROM sets WHERE user_id = $1', [uid])).n, 0);
    assert.equal(
      (await zweite.get("SELECT count(*)::int AS n FROM trash WHERE user_id = $1 AND type = 'set'", [uid])).n,
      1,
    );
  });

  await t.test('the process access stayed untouched', () => {
    assert.equal(prozess.requests, 0);
  });

  await t.test('household memory per access', async () => {
    // The same account ID, two databases: in the second it has a sub-account, in the process access not.
    const UNTER = 987654;
    await zweite.run("INSERT INTO users (id, username, password_hash) VALUES ($1, 'unter_in_zwei', 'x')", [UNTER]);
    await zweite.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, UNTER]);
    alle.household.reportHouseholdChange();
    assert.deepEqual(
      (await require(path.join(ROOT, 'dist/src/household/household.js')).householdOf(contexts.household, uid))
        .memberIds,
      [uid, UNTER],
    );
    const inProcess = await _req('src/household/household.js').householdOf(uid);
    assert.ok(!inProcess.memberIds.includes(UNTER), `memory borrowed from the second database: ${inProcess.memberIds}`);
  });
});
