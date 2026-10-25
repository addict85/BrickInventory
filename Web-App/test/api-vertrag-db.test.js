/**
 * Der API-Vertrag mit der Android-App, in der Suite statt nur von Hand.
 *
 * scripts/check-api-contract.js prüft echte Antworten gegen die Kotlin-Modelle
 * (Models.kt). Bisher lief es nur gegen einen laufenden Server, also selten.
 * Hier läuft es gegen die echten Routen mit Bestand, damit die Listen nicht
 * leer sind — ein leeres Array prüft kein einziges Feld.
 *
 * Gegenprobe (am 25.10. gemessen): `set_number` in der Antwort von
 * GET /api/v1/sets zur Zahl gemacht → rot, das Skript nennt das Feld.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { execFile } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const AUTH = require('./helpers/sources').einhaengung('auth');
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');
const auth = _req('utils/auth.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

const NAME = `vertrag_${process.pid}`, SET = '99071-1';

test('API-Antworten passen zu den Kotlin-Modellen', { concurrency: 1, timeout: 60_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(
    `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', 1, 1) RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO set_catalog (set_number, name, year, theme, pieces, minifigs)
                VALUES ($1, 'Vertragsprobe', 2024, 'Test', 100, 1) ON CONFLICT (set_number) DO NOTHING`, [SET]);
  await haeltSet(db, uid, SET, 2, { preis: 49.9 });
  const token = await auth.createToken(uid, 'Vertragsprobe');

  const app = express();
  app.use(express.json());
  app.use(AUTH, _req('routes/auth.js'));
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);

  try {
    const ergebnis = await new Promise(auf => execFile(process.execPath,
      [path.join(ROOT, 'scripts', 'check-api-contract.js')],
      { env: { ...process.env, BASE_URL: `http://127.0.0.1:${srv.address().port}`, TOKEN: token }, timeout: 30_000 },
      (fehler, stdout, stderr) => auf({ code: fehler ? fehler.code : 0, aus: stdout + stderr })));
    assert.equal(ergebnis.code, 0, `Abweichung vom Android-Vertrag:\n${ergebnis.aus}`);
    assert.match(ergebnis.aus, /✓ GET \/api\/v1\/sets/, ergebnis.aus);
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
