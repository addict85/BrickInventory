/**
 * db/rows.ts (scripts/row-types.js) binds the row types of the repositories to the
 * schema. Checked against the real database: every table and column including NULL stands there
 * like this, and every column type arrives via the access (createDb) as the JavaScript type
 * the file promises.
 *
 * Counter-checks (14.11.2026, each on its own):
 *   A  in scripts/row-types.js `numeric` under 'string' instead of 'number' → red: “every
 *      column type arrives …” (numeric(12,4): expected string, came number)
 *   B  the NUMERIC reader deleted in db/database.ts → red: the same place, reversed
 *   C  a column of price_cache deleted in db/rows.ts → red: “db/rows.ts is generated”
 *      (the call `scripts/row-types.js --pruefen` ends with 1)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const Z = require('../scripts/row-types');

/** One value per PostgreSQL type; `typeof` or class, as node-pg delivers it. */
const PROBE = {
  text: "'x'",
  integer: '1',
  smallint: '1',
  bigint: '1',
  boolean: 'true',
  'timestamp with time zone': 'now()',
  date: 'current_date',
  jsonb: `'{"a":1}'`,
  json: `'{"a":1}'`,
  bytea: "'\\x01'",
  numeric: '1.5',
  'numeric(12,4)': '1.5',
  'numeric(4,3)': '1.5',
  'character(3)': "'abc'",
  'character varying': "'x'",
  'character varying(10)': "'x'",
};

/** @param {unknown} v */
function art(v) {
  if (v instanceof Date) return 'Date';
  if (Buffer.isBuffer(v)) return 'Buffer';
  return typeof v === 'object' ? 'unknown' : typeof v;
}

test('db/rows.ts is generated and matches the schema', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'row-types.js'), '--pruefen'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test('row types against the database', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const db = testAccess();
  t.after(() => db.pool.end());
  const schema = Z.tabellen(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema-snapshot.sql'), 'utf8'));

  await t.test('every table and column including NULL is like this in the database', async () => {
    const zeilen = await db.all(
      // pg_attribute instead of information_schema: the latter only shows columns that the runtime role may read.
      `SELECT c.relname AS t, a.attname AS s, NOT a.attnotnull AS n
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
          AND c.relname = ANY($1)`,
      [[...schema.keys()]],
    );
    const echt = zeilen.map((/** @type {any} */ z) => `${z.t}.${z.s}${z.n ? '?' : ''}`);
    const erzeugt = [...schema].flatMap(([t, sp]) => sp.map(s => `${t}.${s.name}${s.null ? '?' : ''}`));
    assert.ok(erzeugt.length > 300, `nur ${erzeugt.length} Spalten gelesen`);
    assert.deepEqual([...erzeugt].sort(), [...echt].sort());
  });

  await t.test('every column type arrives as db/rows.ts promises', async () => {
    const typen = new Set([...schema.values()].flatMap(sp => sp.map(s => s.typ)));
    const fehlt = [...typen].filter(x => !(x in PROBE));
    assert.deepEqual(fehlt, [], 'Probe für neue Spaltentypen nachtragen');
    for (const typ of typen) {
      const z = await db.get(`SELECT (${PROBE[/** @type {keyof typeof PROBE} */ (typ)]})::${typ} AS v`);
      assert.equal(art(z.v), Z.jsType(typ), `${typ}: erwartet ${Z.jsType(typ)}, kam ${art(z.v)}`);
    }
  });
});
