/**
 * Das Label eines Tokens aus der Anmeldung ist begrenzt (100 Zeichen) und
 * immer Text. Vorher legte /login jedes Label ungekürzt in api_tokens ab.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in /login wieder `label || 'webapp-session'` → rot: 1, 2 und 3 (das
 *      Label kam ungekürzt an, das Objekt nicht als Vorgabe)
 *   B  Kürzen nach UTF-16-Einheiten statt nach Zeichen → rot: „3. …“ (ein
 *      halbes Emoji am Ende)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung } = require('./helpers/sources');
const _req = buildAndRequire();
const AUTH = einhaengung('auth');
const db = _req('db/database.js');
const express   = require(path.join(ROOT, 'node_modules', 'express'));
const session   = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt    = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const NAME = `label_${process.pid}`, PASS = 'label-Passwort-1';

test('Token-Label beim Anmelden', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, 0, 1, 1) RETURNING id`, [NAME, await bcrypt.hash(PASS, 4)])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE $1`, [`%${uid}%`]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const app = express();
  app.use(express.json());
  app.use(session({ store: new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));

  /** Anmelden und das Label des eben ausgestellten Tokens lesen. */
  const labelNach = async (label) => {
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
    const r = await fetch(`http://localhost:${srv.address().port}${AUTH}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, password: PASS, label }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.ok(body.token, 'kein Token ausgestellt');
    return (await db.get('SELECT label FROM api_tokens WHERE user_id = $1', [uid])).label;
  };

  await t.test('1. ein langes Label wird auf 100 Zeichen gekürzt', async () => {
    const gespeichert = await labelNach('Pixel ' + 'x'.repeat(5000));
    assert.equal(gespeichert.length, 100, `${gespeichert.length} Zeichen gespeichert`);
    assert.ok(gespeichert.startsWith('Pixel x'));
    assert.equal(await labelNach('  Galaxy S24  '), 'Galaxy S24', 'ein kurzes bleibt, nur getrimmt');
  });

  await t.test('2. Nicht-Text und Leeres fallen auf die Vorgabe zurück', async () => {
    assert.equal(await labelNach({ name: 'x'.repeat(500) }), 'webapp-session');
    assert.equal(await labelNach(['a', 'b']), 'webapp-session');
    assert.equal(await labelNach('   '), 'webapp-session');
  });

  await t.test('3. gekürzt wird nach Zeichen, nicht mitten in einem', async () => {
    const gespeichert = await labelNach('🧱'.repeat(150));
    assert.equal(Array.from(gespeichert).length, 100);
    assert.equal(gespeichert, '🧱'.repeat(100));
  });
});
