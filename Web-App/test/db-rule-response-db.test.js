'use strict';
/**
 * If a request violates a database rule (CHECK, NOT NULL, UNIQUE,
 * foreign key), the error path answers with 400/409 and a code, not with 500.
 *
 * Counter-checks (measured 05.11.2026):
 *   A  DB_RULES in src/http/httpResponse.ts without '23514' → red: “CHECK violation …”
 *      (500 interner_fehler)
 *   B  asUploadError() without the block for DB_RULES → all four cases red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('rule violations of the database become 4xx with a code', async t => {
  const db = await dataOrSkip(t, _req, { migrieren: false });
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { errorResponse } = _req('src/http/httpResponse.js');
  const app = express();
  // Real errors from PostgreSQL, not rebuilt objects.
  app.get('/:regel', async req => {
    await db.run(`DO $$ BEGIN RAISE ${req.params.regel}; END $$`);
  });
  app.use(errorResponse);
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const hole = async regel => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/${regel}`);
    return { status: r.status, code: (await r.json()).code };
  };
  assert.deepEqual(await hole('check_violation'), { status: 400, code: 'wert_ungueltig' }, 'CHECK-Verletzung …');
  assert.deepEqual(await hole('not_null_violation'), { status: 400, code: 'wert_ungueltig' }, 'NOT NULL …');
  assert.deepEqual(await hole('unique_violation'), { status: 409, code: 'schon_vorhanden' }, 'UNIQUE …');
  assert.deepEqual(await hole('foreign_key_violation'), { status: 409, code: 'bezug_fehlt' }, 'Fremdschlüssel …');
  // A real server error stays one.
  assert.equal((await hole('division_by_zero')).status, 500);
});
