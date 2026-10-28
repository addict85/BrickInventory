/**
 * Ein Verwalter legt ein Konto nur mit seinem Passwort an, das Protokoll hält
 * es fest, und „false“ als Zeichenkette ergibt keinen Verwalter.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  bestaetigePasswort() aus POST /users entfernt → rot: „ohne
 *      Verwalterpasswort kein Konto“
 *   B  wieder `isAdmin ? 1 : 0` statt strictBool → rot: „"false" legt keinen
 *      Verwalter an“
 *   C  protokolliere(…, 'konto_angelegt') entfernt → rot: „das Protokoll …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
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
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const CHEF = `anlage_chef_${process.pid}`, PASS = 'richtigesPasswort1';
const NEU = [`anlage_a_${process.pid}`, `anlage_b_${process.pid}`, `anlage_c_${process.pid}`];

test('Konto anlegen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ...NEU]]);
  await db.run('INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,1,1,1)',
    [CHEF, await bcrypt.hash(PASS, 4)]);

  const app = express();
  app.use(express.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;
  t.after(async () => {
    srv.close();
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ...NEU]]);
    await db.pool.end().catch(() => {});
  });
  const ruf = async (weg, body, cookie) => {
    const r = await fetch(basis + weg, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const a = await ruf(AUTH + '/login', { username: CHEF, password: PASS });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const cookie = a.cookie.split(';')[0];
  const konto = (n) => db.get('SELECT id, is_admin FROM users WHERE username = $1', [n]);

  await t.test('ohne Verwalterpasswort kein Konto', async () => {
    const r = await ruf(AUTH + '/users', { username: NEU[0], password: 'einPasswort123' }, cookie);
    assert.notEqual(r.status, 200);
    assert.equal(await konto(NEU[0]), undefined);
  });

  await t.test('"false" legt keinen Verwalter an', async () => {
    const r = await ruf(AUTH + '/users', { username: NEU[1], password: 'einPasswort123', isAdmin: 'false', admin_password: PASS }, cookie);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Number((await konto(NEU[1])).is_admin), 0);
  });

  await t.test('die Weboberfläche legt mit is_admin einen Verwalter an, und das Protokoll hält beides fest', async () => {
    const r = await ruf(AUTH + '/users', { username: NEU[2], password: 'einPasswort123', is_admin: true, admin_password: PASS }, cookie);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const k = await konto(NEU[2]);
    assert.equal(Number(k.is_admin), 1, 'die Checkbox „Admin“ wirkt nicht');
    const p = (await db.all('SELECT aktion FROM verwaltungsprotokoll WHERE ziel_id = $1 ORDER BY id', [k.id])).map(z => z.aktion);
    assert.deepEqual(p, ['konto_angelegt', 'verwalter_ernannt'], 'das Protokoll hält die Anlage nicht fest');
  });
});
