/**
 * No index is the start of another of the same table, and every
 * foreign key has an index that starts with its columns — checked on the
 * catalog of the migrated database (migration 0068).
 *
 * Counter-checks (measured on 29.10.2026, each on a fresh database):
 *   A  `DROP INDEX IF EXISTS idx_sets_user` removed from 0068 → red: “no
 *      index is the start of another” (sets: idx_sets_user)
 *   B  `CREATE INDEX idx_minifigs_set` removed from 0068 → red: “every
 *      foreign key has an index” (minifigs_set_fk)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { accessOrSkip } = require('./helpers/db');

/** Columns and operator classes as normal arrays (int2vector starts at 0). */
const INDEXES = `
  SELECT i.indexrelid, i.indrelid, c.relname AS name, t.relname AS tabelle,
         i.indisunique AS eindeutig, i.indpred IS NOT NULL AS teil, i.indexprs IS NOT NULL AS ausdruck,
         pg_get_expr(i.indpred, i.indrelid) AS bedingung,
         (ARRAY(SELECT unnest(i.indkey::int2[])))[1:i.indnkeyatts] AS spalten,
         ARRAY(SELECT unnest(i.indclass::oid[])) AS klassen, am.amname AS kind
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
    JOIN pg_am am ON am.oid = c.relam`;

test('indexes', { concurrency: 1 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;

  try {
    await t.test('no index is the start of another', async () => {
      const alle = await db.all(`WITH ix AS (${INDEXES}) SELECT COUNT(*)::int AS n FROM ix`);
      assert.ok(alle[0].n > 100, `nur ${alle[0].n} Indizes gefunden — greift die Abfrage?`);
      const double = await db.all(`
        WITH ix AS (${INDEXES})
        SELECT a.tabelle || ': ' || a.name || ' (Anfang von ' || b.name || ')' AS d
          FROM ix a JOIN ix b ON a.indrelid = b.indrelid AND a.indexrelid <> b.indexrelid
         WHERE NOT a.eindeutig AND NOT a.teil AND NOT a.ausdruck AND NOT b.teil
           AND a.kind = 'btree' AND b.kind = 'btree'
           AND array_length(a.spalten, 1) <= array_length(b.spalten, 1)
           AND a.spalten = b.spalten[1:array_length(a.spalten, 1)]
           AND a.klassen[1:array_length(a.spalten, 1)] = b.klassen[1:array_length(a.spalten, 1)]
         ORDER BY 1`);
      assert.deepEqual(
        double.map(z => z.d),
        [],
      );
    });

    await t.test('every foreign key has an index', async () => {
      const ohne = await db.all(`
        WITH ix AS (${INDEXES})
        SELECT c.conname || ' (' || c.conrelid::regclass || ')' AS d
          FROM pg_constraint c
         WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
           AND NOT EXISTS (SELECT 1 FROM ix WHERE ix.indrelid = c.conrelid
                             AND ix.spalten[1:array_length(c.conkey, 1)] = c.conkey::int2[]
                             -- Ein Teilindex hilft nur, wenn seine Bedingung aus dem Schlüssel folgt.
                             AND (NOT ix.teil OR ix.bedingung = '(' || (SELECT attname FROM pg_attribute
                                    WHERE attrelid = c.conrelid AND attnum = c.conkey[array_upper(c.conkey, 1)]) || ' IS NOT NULL)'))
         ORDER BY 1`);
      assert.deepEqual(
        ohne.map(z => z.d),
        [],
      );
    });
  } finally {
    await db.pool.end().catch(() => {});
  }
});
