'use strict';
/**
 * Verletzt eine Anfrage eine Regel der Datenbank (CHECK, NOT NULL, UNIQUE,
 * Fremdschlüssel), antwortet der Fehlerweg mit 400/409 und Code, nicht mit 500.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  DB_REGELN in src/http/httpAntwort.ts ohne '23514' → rot: „CHECK-Verletzung …“
 *      (500 interner_fehler)
 *   B  alsUploadFehler() ohne den Block für DB_REGELN → alle vier Fälle rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('Regelverletzungen der Datenbank werden zu 4xx mit Code', async t => {
  const db = await dbOderSkip(t, _req, { migrieren: false });
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const { fehlerAntwort } = _req('src/http/httpAntwort.js');
  const app = express();
  // Echte Fehler aus PostgreSQL, nicht nachgebaute Objekte.
  app.get('/:regel', async req => {
    await db.run(`DO $$ BEGIN RAISE ${req.params.regel}; END $$`);
  });
  app.use(fehlerAntwort);
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
  // Ein echter Serverfehler bleibt einer.
  assert.equal((await hole('division_by_zero')).status, 500);
});
