/**
 * An empty database gets its schema from db/base.sql, an existing one
 * is not touched at startup — only the migrations run.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  the check for an empty database removed in initSchema() → red:
 *      “an existing database stays as it is” (the base fails on
 *      existing tables)
 *   B  (10.11.) the first start from createDb(…, { firstStart }) not called → red:
 *      “an empty database gets base, defaults and an administrator”
 *   D  (29.10.) in initSchema() again the lock „older than 0050“ → red:
 *      “a database with 0045 but without 0050 starts …” (the state of
 *      main up to 1ad80a5).
 *   F  (09.11.) a line `ALTER TABLE ONLY public.users ALTER COLUMN …` added by hand
 *      to db/base.sql → red: “db/base.sql is an unchanged image …”; likewise a migration that
 *      stands as applied in base.sql whose file does not exist → red: “… a gapless sequence …”
 *   E  (08.11.) the call checkMinimumVersion() removed in initSchemaOnce()
 *      → red: “a database older than 0050 stops the start …” (the start
 *      ran through and applied the open migrations)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL whose user may create
 * databases.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASIS = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { testName, cleanRemainder, id } = require('./helpers/test-names');
const NAME = testName('schema_basis');
const target = new URL(BASIS);
target.pathname = '/' + NAME;
process.env.DATABASE_URL = target.toString();
process.env.ADMIN_PASSWORD = 'Basis-Pruefung-2026';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

test('first start via db/base.sql', { concurrency: 1, timeout: 180_000 }, async t => {
  const admin = new Client({ connectionString: BASIS });
  try {
    await admin.connect();
  } catch (e) {
    noDb(t, e);
    return;
  }
  await cleanRemainder(admin, 'schema_basis');
  await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)}`);
  await admin.query(`CREATE DATABASE ${id(NAME)}`);
  // Like server.ts: the access gets the first start along, which creates the first account.
  const mod = require(path.join(ROOT, 'dist', 'db', 'database.js'));
  const db = mod.createDb(mod.dbConfigFromEnvironment(), {
    firstStart: () => require('./helpers/sources').testServices().account.createStartAdmin(),
  });
  t.after(async () => {
    await db.pool.end().catch(() => {});
    await testData()
      .pool.end()
      .catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  });

  await t.test('an empty database gets base, defaults and an administrator', async () => {
    await db.initSchemaOnce();
    const account = await db.get(`SELECT is_admin, is_active FROM users WHERE username = 'admin'`);
    assert.equal(Number(account?.is_admin), 1, 'no administrator created');
    const preset = await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_bricklink'`);
    assert.equal(preset?.value, '4000', 'the default values are missing');
    const rb = await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_rebrickable'`);
    assert.equal(rb?.value, '25000', 'the Rebrickable daily limit of a new installation must be 25000');
    const pk = await db.get(`SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'rate_limit_attempts'::regclass AND i.indisprimary`);
    assert.equal(pk?.attname, 'key', 'the login counters need their key as primary key');
    const files = fs
      .readdirSync(path.join(ROOT, 'db/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort();
    const applied = (await db.all('SELECT name FROM schema_migrations')).map(r => r.name);
    assert.deepEqual(
      files.filter(f => !applied.includes(f)),
      [],
      'not every migration counts as applied',
    );
  });

  await t.test('an existing database stays as it is', async () => {
    await db.run(`UPDATE users SET is_active = false WHERE username = 'admin'`);
    await db.run(`UPDATE global_settings SET value = '123' WHERE key = 'api_limit_bricklink'`);
    assert.equal(await db.initSchema(), false, 'the base was loaded again');
    await db.initSchemaOnce();
    assert.equal(
      Number((await db.get(`SELECT is_active FROM users WHERE username = 'admin'`)).is_active),
      0,
      'a disabled administrator account was enabled again',
    );
    assert.equal((await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_bricklink'`)).value, '123');
  });

  // The state of main up to 1ad80a5: 0045 there, 0050 not yet.
  await t.test('a database with 0045 but without 0050 starts and catches up on 0050', async () => {
    await db.run(`DELETE FROM schema_migrations WHERE name LIKE '0050-%'`);
    assert.equal(await db.initSchema(), false);
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
    assert.ok(await db.get(`SELECT 1 FROM schema_migrations WHERE name LIKE '0050-%'`), '0050 not caught up');
  });

  // A state before 0050 would have to catch up on the removed start stages; the start
  // says so instead of putting the younger migrations onto a foreign schema.
  await t.test('a database older than 0050 stops the start and stays untouched', async () => {
    await db.run(`DELETE FROM schema_migrations WHERE name >= '0050'`);
    const prior = (await db.get('SELECT COUNT(*)::int AS n FROM schema_migrations')).n;
    assert.ok(prior > 0, 'the probe needs migrations before 0050');
    await assert.rejects(db.initSchemaOnce(), /älter als Migration 0050.*UPGRADE\.md/s);
    assert.equal(
      (await db.get('SELECT COUNT(*)::int AS n FROM schema_migrations')).n,
      prior,
      'a migration ran on the too old state',
    );
    await db.run('DROP TABLE schema_migrations');
    await assert.rejects(
      db.initSchemaOnce(),
      /älter als Migration 0050/,
      'without a migrations table the database counts as too old',
    );
  });
});

test('db/base.sql is generated, not written', { concurrency: 1, timeout: 180_000 }, async t => {
  const admin = new Client({ connectionString: BASIS });
  try {
    await admin.connect();
  } catch (e) {
    noDb(t, e);
    return;
  }
  const NAME2 = testName('schema_abbild');
  await cleanRemainder(admin, 'schema_abbild');
  await admin.query(`CREATE DATABASE ${id(NAME2)}`);
  const target2 = new URL(BASIS);
  target2.pathname = '/' + NAME2;
  const c = new Client({ connectionString: target2.toString() });
  t.after(async () => {
    await c.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${id(NAME2)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  });
  await c.connect();
  const file = fs.readFileSync(path.join(ROOT, 'db/base.sql'), 'utf8');
  await c.query(file);

  await t.test('the base names a gapless sequence of existing migrations', async () => {
    const inBasis = (await c.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r => r.name);
    const files = fs
      .readdirSync(path.join(ROOT, 'db/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort();
    assert.ok(inBasis.length > 50, `only ${inBasis.length} migrations in the base`);
    assert.deepEqual(inBasis, files.slice(0, inBasis.length), 'The base is an image of the first N migration files');
  });

  await t.test('db/base.sql is an unchanged image of the database it creates', async tt => {
    const sk = require(path.join(ROOT, 'scripts', 'schema-snapshot.js'));
    const createdWith = Number((file.match(/^-- Generated with pg_dump (\d+)\./m) || [])[1]);
    let now = null;
    try {
      now = sk.pgDumpVersion();
    } catch {
      /* no pg_dump in the path */
    }
    // pg_dump writes differently per major version; it is only compared with the same one.
    if (now !== createdWith) {
      tt.skip(`pg_dump ${now ?? 'missing'}, the base was created with ${createdWith}`);
      return;
    }
    assert.equal(
      sk.basisText(target2.toString()),
      file,
      'db/base.sql differs from the generated output — do not edit by hand, regenerate: npm run build && npm run schema:snapshot',
    );
  });
});
