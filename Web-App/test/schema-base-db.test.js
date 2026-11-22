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
const ziel = new URL(BASIS);
ziel.pathname = '/' + NAME;
process.env.DATABASE_URL = ziel.toString();
process.env.ADMIN_PASSWORD = 'Basis-Pruefung-2026';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

test('first start via db/base.sql', { concurrency: 1, timeout: 180_000 }, async t => {
  const admin = new Client({ connectionString: BASIS });
  try {
    await admin.connect();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await cleanRemainder(admin, 'schema_basis');
  await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)}`);
  await admin.query(`CREATE DATABASE ${id(NAME)}`);
  // Like server.ts: the access gets the first start along, which creates the first account.
  const modul = require(path.join(ROOT, 'dist', 'db', 'database.js'));
  const db = modul.createDb(modul.dbConfigFromEnvironment(), {
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
    const konto = await db.get(`SELECT is_admin, is_active FROM users WHERE username = 'admin'`);
    assert.equal(Number(konto?.is_admin), 1, 'kein Administrator angelegt');
    const vorgabe = await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_bricklink'`);
    assert.equal(vorgabe?.value, '4000', 'die Vorgabewerte fehlen');
    const rb = await db.get(`SELECT value FROM global_settings WHERE key = 'api_limit_rebrickable'`);
    assert.equal(rb?.value, '25000', 'das Rebrickable-Tageslimit einer Neuinstallation muss 25000 sein');
    const pk = await db.get(`SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'rate_limit_attempts'::regclass AND i.indisprimary`);
    assert.equal(pk?.attname, 'key', 'die Anmeldezähler brauchen ihren Schlüssel als Primärschlüssel');
    const dateien = fs
      .readdirSync(path.join(ROOT, 'db/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort();
    const angewandt = (await db.all('SELECT name FROM schema_migrations')).map(r => r.name);
    assert.deepEqual(
      dateien.filter(f => !angewandt.includes(f)),
      [],
      'nicht jede Migration gilt als angewandt',
    );
  });

  await t.test('an existing database stays as it is', async () => {
    await db.run(`UPDATE users SET is_active = false WHERE username = 'admin'`);
    await db.run(`UPDATE global_settings SET value = '123' WHERE key = 'api_limit_bricklink'`);
    assert.equal(await db.initSchema(), false, 'die Basis wurde erneut eingespielt');
    await db.initSchemaOnce();
    assert.equal(
      Number((await db.get(`SELECT is_active FROM users WHERE username = 'admin'`)).is_active),
      0,
      'ein abgeschaltetes Administratorkonto wurde wieder freigeschaltet',
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
    assert.ok(await db.get(`SELECT 1 FROM schema_migrations WHERE name LIKE '0050-%'`), '0050 nicht nachgeholt');
  });

  // A state before 0050 would have to catch up on the removed start stages; the start
  // says so instead of putting the younger migrations onto a foreign schema.
  await t.test('a database older than 0050 stops the start and stays untouched', async () => {
    await db.run(`DELETE FROM schema_migrations WHERE name >= '0050'`);
    const vorher = (await db.get('SELECT COUNT(*)::int AS n FROM schema_migrations')).n;
    assert.ok(vorher > 0, 'die Probe braucht Migrationen vor 0050');
    await assert.rejects(db.initSchemaOnce(), /älter als Migration 0050.*UPGRADE\.md/s);
    assert.equal(
      (await db.get('SELECT COUNT(*)::int AS n FROM schema_migrations')).n,
      vorher,
      'auf dem zu alten Stand lief eine Migration',
    );
    await db.run('DROP TABLE schema_migrations');
    await assert.rejects(
      db.initSchemaOnce(),
      /älter als Migration 0050/,
      'ohne Migrationstabelle gilt die Datenbank als zu alt',
    );
  });
});

test('db/base.sql is generated, not written', { concurrency: 1, timeout: 180_000 }, async t => {
  const admin = new Client({ connectionString: BASIS });
  try {
    await admin.connect();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  const NAME2 = testName('schema_abbild');
  await cleanRemainder(admin, 'schema_abbild');
  await admin.query(`CREATE DATABASE ${id(NAME2)}`);
  const ziel2 = new URL(BASIS);
  ziel2.pathname = '/' + NAME2;
  const c = new Client({ connectionString: ziel2.toString() });
  t.after(async () => {
    await c.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${id(NAME2)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  });
  await c.connect();
  const datei = fs.readFileSync(path.join(ROOT, 'db/base.sql'), 'utf8');
  await c.query(datei);

  await t.test('the base names a gapless sequence of existing migrations', async () => {
    const inBasis = (await c.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r => r.name);
    const dateien = fs
      .readdirSync(path.join(ROOT, 'db/migrations'))
      .filter(f => f.endsWith('.sql'))
      .sort();
    assert.ok(inBasis.length > 50, `nur ${inBasis.length} Migrationen in der Basis`);
    assert.deepEqual(
      inBasis,
      dateien.slice(0, inBasis.length),
      'Die Basis ist ein Abbild der ersten N Migrationsdateien',
    );
  });

  await t.test('db/base.sql is an unchanged image of the database it creates', async tt => {
    const sk = require(path.join(ROOT, 'scripts', 'schema-snapshot.js'));
    const createdWith = Number((datei.match(/^-- Generated with pg_dump (\d+)\./m) || [])[1]);
    let jetzt = null;
    try {
      jetzt = sk.pgDumpVersion();
    } catch {
      /* no pg_dump in the path */
    }
    // pg_dump writes differently per major version; it is only compared with the same one.
    if (jetzt !== createdWith) {
      tt.skip(`pg_dump ${jetzt ?? 'missing'}, the base was created with ${createdWith}`);
      return;
    }
    assert.equal(
      sk.basisText(ziel2.toString()),
      datei,
      'db/base.sql weicht vom Erzeugnis ab — nicht von Hand ändern, neu erzeugen: npm run build && npm run schema:snapshot',
    );
  });
});
