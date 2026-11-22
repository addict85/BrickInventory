/**
 * A fresh database, built as at the first start: every account column
 * has a foreign key on users, an account can be deleted including everything,
 * and a second start changes nothing in the schema.
 *
 * Counter-checks (measured on 27.10.):
 *   A  migration 0043 renamed to .sql.aus → red: “every account column has a
 *      foreign key” (seven columns), “an account disappears completely” and
 *      “deleting searches via an index” (account_link_invites)
 *   E  in 0043 the key also on parts_version_user → red: “an account
 *      disappears completely” (the deletion fails on the counting trigger)
 *   B  the index idx_qr_login_user removed in 0043 → red: “deleting searches
 *      via an index”
 *   C  the second start via initSchema() instead of initSchemaOnce() → red: “a
 *      second start changes nothing in the schema” — initSchema creates the columns
 *      deleted by 0036 to 0038 again. That is why it runs only once.
 *   F  a column deleted in db/schema-snapshot.sql → red: “db/schema-snapshot.sql
 *      shows the schema that results”; likewise a new migration without a newly
 *      generated file
 *   D  (08.11.) initSchema() without the check for an empty database → red:
 *      “a second start changes nothing in the schema” and “even a forced
 *      run …” (the base fails on existing tables)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (may create databases).
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASIS = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { testName, cleanRemainder, id } = require('./helpers/test-names');
const { catalogSet } = require('./helpers/inventory');
const NAME = testName('schema_frisch');
const ziel = new URL(BASIS);
ziel.pathname = '/' + NAME;
process.env.DATABASE_URL = ziel.toString();

const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');

const KONTOSPALTEN = ['user_id', 'main_user_id', 'sub_user_id'];
/** Deliberately without a key — with a reason. */
const WITHOUT_KEY = new Map([
  ['parts_version_user.user_id', 'Die Zähltrigger schreiben dort auch beim kaskadierten Löschen eines Kontos'],
]);

async function schemaImage(db) {
  const spalten = await db.all(`SELECT table_name, column_name, data_type, is_nullable, column_default
                                  FROM information_schema.columns WHERE table_schema = 'public'
                                 ORDER BY 1, 2`);
  const schranken = await db.all(`SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS d
                                    FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`);
  const indizes = await db.all(`SELECT tablename, indexname, indexdef FROM pg_indexes
                                 WHERE schemaname = 'public' ORDER BY 1, 2`);
  return { spalten, schranken, indizes };
}

test('fresh database', { concurrency: 1, timeout: 180_000 }, async t => {
  const admin = new Client({ connectionString: BASIS });
  try {
    await admin.connect();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await cleanRemainder(admin, 'schema_frisch');
  await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)}`);
  await admin.query(`CREATE DATABASE ${id(NAME)}`);

  const db = testData();
  // The same path as at server start: initSchema only the first time, the
  // migrations always.
  const starte = () => db.initSchemaOnce();
  t.after(async () => {
    await db.pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${id(NAME)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  });

  await starte();

  await t.test('every account column has a foreign key', async () => {
    const open = await db.all(
      `
      SELECT c.table_name || '.' || c.column_name AS spalte
        FROM information_schema.columns c
        JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = 'public'
                                         AND tb.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = ANY($1)
         AND NOT EXISTS (
           SELECT 1 FROM pg_constraint k
            WHERE k.contype = 'f' AND k.conrelid = (quote_ident(c.table_name))::regclass
              AND k.confrelid = 'users'::regclass
              AND (SELECT attname FROM pg_attribute WHERE attrelid = k.conrelid AND attnum = k.conkey[1]) = c.column_name)
       ORDER BY 1`,
      [KONTOSPALTEN],
    );
    assert.deepEqual(
      open.map(r => r.spalte).filter(s => !WITHOUT_KEY.has(s)),
      [],
    );
    const alle = await db.get(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
                                WHERE table_schema = 'public' AND column_name = ANY($1)`,
      [KONTOSPALTEN],
    );
    assert.ok(alle.n >= 20, `Nur ${alle.n} Kontospalten gefunden — greift die Suche noch?`);
  });

  await t.test('an account disappears completely', async () => {
    const uid = (
      await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                                VALUES ('frisch_loeschen', 'x', true, true) RETURNING id`)
    ).id;
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price)
                  VALUES ($1, '3001', 5, 2, 0.12)`,
      [uid],
    );
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price)
                  VALUES ($1, 'sw0001', 1, 9.5)`,
      [uid],
    );
    await db.run(`INSERT INTO qr_login_tokens (token, user_id, expires_at) VALUES ('frisch', $1, NOW())`, [uid]);
    // Inventory, so that the counting triggers on parts and sets fire on deletion.
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3001', 5, 'manual')`, [uid]);
    await catalogSet(db, '99073-1', { name: 'Frisch' });
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '99073-1')`, [uid]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    for (const tab of ['part_acquisitions', 'minifig_acquisitions', 'qr_login_tokens', 'parts', 'sets'])
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int AS n FROM ${tab} WHERE user_id = $1`, [uid])).n,
        0,
        `${tab} behält Zeilen eines gelöschten Kontos`,
      );
  });

  await t.test('deleting searches via an index', async () => {
    const ohne = await db.all(`
      SELECT k.conrelid::regclass::text AS t FROM pg_constraint k
       WHERE k.contype = 'f' AND k.confrelid = 'users'::regclass
         AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.conrelid AND i.indkey[0] = k.conkey[1])
       ORDER BY 1`);
    assert.deepEqual(
      ohne.map(r => r.t),
      [],
      'Ohne Index durchsucht jedes Löschen eines Kontos die ganze Tabelle',
    );
  });

  await t.test('db/schema-snapshot.sql shows the schema that results', async () => {
    const { schemaText, OUT_FILE: DATEI } = require(path.join(ROOT, 'scripts', 'schema-snapshot.js'));
    const eingecheckt = require('node:fs').readFileSync(DATEI, 'utf8');
    assert.equal(
      await schemaText(db),
      eingecheckt,
      'db/schema-snapshot.sql ist veraltet — neu erzeugen: npm run build && npm run schema:snapshot',
    );
  });

  await t.test('a second start changes nothing in the schema', async () => {
    const vorher = await schemaImage(db);
    await starte();
    assert.deepEqual(await schemaImage(db), vorher);
  });

  await t.test('even a forced run does not bring back deleted items', async () => {
    const vorher = await schemaImage(db);
    process.env.FORCE_SCHEMA_INIT = '1';
    try {
      await starte();
    } finally {
      delete process.env.FORCE_SCHEMA_INIT;
    }
    assert.deepEqual(
      await schemaImage(db),
      vorher,
      'FORCE_SCHEMA_INIT legt Spalten wieder an, die Migrationen gelöscht haben',
    );
  });
});
