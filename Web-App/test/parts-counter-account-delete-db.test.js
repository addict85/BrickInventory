/**
 * On an existing database an account with parts can be deleted.
 *
 * Only the first start creates the counter triggers; migration 0050 brings the
 * version with a user filter to existing databases. The test inserts the
 * old version, runs 0050 again and then deletes an account.
 *
 * Counter-check (measured on 28.10.2026): the content of
 * 0050-teilezaehler-nur-bestehende-konten.sql replaced by `SELECT 1;` →
 * red: “deleting an account with parts succeeds” (23503 on
 * parts_version_user_user_id_fkey).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { holdsPart } = require('./helpers/inventory');

const ALT = (name, source) => `
  CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$
  BEGIN
    INSERT INTO parts_version_user (user_id, v)
    SELECT DISTINCT user_id, 1 FROM ${source} WHERE user_id IS NOT NULL
    ON CONFLICT (user_id) DO UPDATE SET v = parts_version_user.v + 1;
    RETURN NULL;
  END $$ LANGUAGE plpgsql`;

test('parts counter and account deletion', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const migrateIt = async () => {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  };
  await migrateIt();

  // The state of a database before this update.
  await db.run(ALT('bump_parts_version_ins', 'neu'));
  await db.run(ALT('bump_parts_version_del', 'alt'));
  await db.run(`DELETE FROM schema_migrations WHERE name = '0050-teilezaehler-nur-bestehende-konten.sql'`);
  await migrateIt();

  const NAME = `zaehler-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await holdsPart(db, uid, '3001', { quantity: 2, colorId: 4 });

  try {
    await t.test('deleting an account with parts succeeds', async () => {
      await db.run('DELETE FROM users WHERE id=$1', [uid]);
      assert.equal(await db.get('SELECT 1 FROM parts WHERE user_id=$1', [uid]), undefined);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
