/**
 * In the parallel run (scripts/test-run.js) every test file has its own
 * database: a copy of the template with a finished schema, named after the
 * process. Outside of this run (npm run test:serial, single call)
 * there is nothing to check.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in scripts/test-run.js the preloader (--require) left out → red:
 *      “the file has its own copy of the template” (the base database)
 *   B  in test/helpers/test-db.js `TEMPLATE` left out (empty database)
 *      → red: the same check (relation schema_migrations missing)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('the file has its own copy of the template', async t => {
  const template = process.env.TEST_DB_TEMPLATE;
  if (!template) {
    t.skip('no parallel run');
    return;
  }
  const url = new URL(process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest');
  assert.equal(url.pathname, `/${template}_${process.pid}`);
  const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  try {
    const r = await c.query(`SELECT to_regclass('public.users') IS NOT NULL AS schema,
                                    (SELECT count(*)::int FROM schema_migrations) AS migrations`);
    assert.equal(r.rows[0].schema, true, 'the copy carries the schema of the template');
    assert.ok(r.rows[0].migrations > 50);
  } finally {
    await c.end();
  }
});
