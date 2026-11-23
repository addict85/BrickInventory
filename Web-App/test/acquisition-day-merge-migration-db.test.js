/**
 * Migration 0004 merges legacy duplicates into one acquisition per entry and day: quantities add up,
 * the price is the quantity-weighted mean of the rows WITH a price, „used" wins, other days stay.
 * The SQL file runs against duplicates in a transaction that is rolled back (today's unique daily
 * indexes are dropped in it, otherwise the legacy state could not be built).
 *
 * Counter-checks (22.11.2026, each alone, on a copy of the migration — the original is guarded by checksum):
 *   A  the FILTER on purchase_price removed from the set price → red “sets” (5 instead of 10)
 *   B  „used" no longer wins (`MIN` instead of `MAX`) → red “sets” (N instead of U)
 *   C  the part block touches no group (HAVING COUNT(*) > 99) → red “parts” (two rows)
 *   D  the set DELETE removes nothing → red “sets” (the merged-away row stays)
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0004-erfassung-pro-tag.sql'), 'utf8');

test('migration 0004 merges duplicates of a day', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const unique = await c.query(
      `SELECT i.indexrelid::regclass::text AS name FROM pg_index i
        WHERE i.indisunique AND NOT i.indisprimary
          AND i.indrelid IN ('set_acquisitions'::regclass, 'part_acquisitions'::regclass, 'minifig_acquisitions'::regclass)`,
    );
    for (const { name } of unique.rows) await c.query(`DROP INDEX ${name}`);
    const uid = (
      await c.query(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [`mig4-${process.pid}`])
    ).rows[0].id;
    await c.query(`INSERT INTO sets (user_id, set_number) VALUES ($1,'40004-1')`, [uid]);
    await c.query(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,'m4p',4,'manual')`, [uid]);
    const day = `'2026-03-01 10:00+00'`,
      later = `'2026-03-01 15:00+00'`,
      other = `'2026-03-05 10:00+00'`;
    await c.query(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, created_at) VALUES
         ($1,'40004-1',1,10,'N',${day}), ($1,'40004-1',1,NULL,'U',${later}), ($1,'40004-1',1,30,'N',${other})`,
      [uid],
    );
    await c.query(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at) VALUES
         ($1,'m4p',4,1,1,'N',${day}), ($1,'m4p',4,3,2,'N',${later})`,
      [uid],
    );
    await c.query(MIGRATION);
    const sets = await c.query(
      `SELECT quantity, purchase_price::float AS price, condition, to_char(created_at AT TIME ZONE 'UTC','DD HH24') AS am
         FROM set_acquisitions WHERE user_id = $1 ORDER BY created_at`,
      [uid],
    );
    await t.test('sets', () =>
      assert.deepEqual(sets.rows, [
        { quantity: 2, price: 10, condition: 'U', am: '01 10' },
        { quantity: 1, price: 30, condition: 'N', am: '05 10' },
      ]),
    );
    const parts = await c.query(
      `SELECT quantity, unit_price::float AS price FROM part_acquisitions WHERE user_id = $1`,
      [uid],
    );
    await t.test('parts', () => assert.deepEqual(parts.rows, [{ quantity: 4, price: 1.75 }]));
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
});
