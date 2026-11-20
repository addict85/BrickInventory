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
 * Gegenproben (01.11.2026 gemessen):
 *   D  Migration 0090 nach .sql.aus und nameTaken() aus POST /users entfernt → rot:
 *      „ein Name in anderer Schreibweise ist vergeben“ und „die Datenbank lehnt …“;
 *      nur nameTaken() entfernt bleibt grün (der Index fängt es, 409 über asDuplicate)
 *   E  RAISE EXCEPTION in 0090 durch RAISE WARNING ersetzt → rot: „Migration 0090 bricht …“
 *   F  accountToLogin wieder mit db.get (erster Treffer) → rot: „passt ein Name auf zwei Konten …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, einhaengung, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = einhaengung('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const CHEF = `anlage_chef_${process.pid}`,
  PASS = 'richtigesPasswort1';
const NEU = [`anlage_a_${process.pid}`, `anlage_b_${process.pid}`, `anlage_c_${process.pid}`];

test('create account', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ...NEU]]);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
    [CHEF, await bcrypt.hash(PASS, 4)],
  );

  const app = express();
  app.use(express.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;
  t.after(async () => {
    srv.close();
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[CHEF, ...NEU]]);
    await db.pool.end().catch(() => {});
  });
  const ruf = async (weg, body, cookie) => {
    const r = await fetch(basis + weg, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const a = await ruf(AUTH + '/login', { username: CHEF, password: PASS, ohne_token: true });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const cookie = a.cookie.split(';')[0];
  const konto = n => db.get('SELECT id, is_admin FROM users WHERE username = $1', [n]);

  await t.test('no account without admin password', async () => {
    const r = await ruf(AUTH + '/users', { username: NEU[0], password: 'einPasswort123' }, cookie);
    assert.notEqual(r.status, 200);
    assert.equal(await konto(NEU[0]), undefined);
  });

  await t.test('"false" creates no admin', async () => {
    const r = await ruf(
      AUTH + '/users',
      { username: NEU[1], password: 'einPasswort123', isAdmin: 'false', admin_password: PASS },
      cookie,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Number((await konto(NEU[1])).is_admin), 0);
  });

  await t.test('the web UI creates an admin with is_admin, and the log records both', async () => {
    const r = await ruf(
      AUTH + '/users',
      { username: NEU[2], password: 'einPasswort123', is_admin: true, admin_password: PASS },
      cookie,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const k = await konto(NEU[2]);
    assert.equal(Number(k.is_admin), 1, 'die Checkbox „Admin“ wirkt nicht');
    const p = (await db.all('SELECT action FROM admin_log WHERE target_id = $1 ORDER BY id', [k.id])).map(
      z => z.action,
    );
    assert.deepEqual(p, ['konto_angelegt', 'verwalter_ernannt'], 'das Protokoll hält die Anlage nicht fest');
  });

  await t.test('a name in a different spelling is taken', async () => {
    const r = await ruf(
      AUTH + '/users',
      { username: NEU[1].toUpperCase(), password: 'einPasswort123', admin_password: PASS },
      cookie,
    );
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, 'benutzername_vergeben');
    const n = await db.get('SELECT COUNT(*)::int AS n FROM users WHERE lower(username) = lower($1)', [NEU[1]]);
    assert.equal(n.n, 1);
  });

  await t.test('the database rejects names that only differ in spelling', async () => {
    await assert.rejects(
      db.run('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [NEU[2].toUpperCase(), 'x']),
      (/** @type {any} */ e) => e.code === '23505',
    );
  });

  await t.test('migration 0090 aborts on duplicates with the names instead of changing data', async () => {
    const sql = require('node:fs').readFileSync(
      path.join(ROOT, 'db/migrations/0090-benutzername-ohne-gross-klein.sql'),
      'utf8',
    );
    const k = await db.pool.connect();
    try {
      await k.query('BEGIN');
      await k.query('DROP INDEX users_username_lower');
      await k.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [NEU[2].toUpperCase(), 'x']);
      await assert.rejects(
        k.query(sql),
        (/** @type {any} */ e) => e.message.includes(NEU[2]) && e.message.includes(NEU[2].toUpperCase()),
      );
    } finally {
      await k.query('ROLLBACK');
      k.release();
    }
  });

  await t.test('if a name matches two accounts, nobody logs in', async st => {
    const altname = `alt_${process.pid}@example.org`;
    await db.run('DELETE FROM users WHERE username = $1 OR lower(email) = lower($1)', [altname]);
    st.after(() => db.run('DELETE FROM users WHERE username = $1 OR lower(email) = lower($1)', [altname]));
    const h = await bcrypt.hash(PASS, 4);
    // Altbestand: ein Name mit @ (heute verboten) gleich der Adresse eines anderen Kontos.
    await db.run('INSERT INTO users (username,password_hash,is_active,email_verified) VALUES ($1,$2,true,true)', [
      altname,
      h,
    ]);
    await db.run(
      'INSERT INTO users (username,email,password_hash,is_active,email_verified) VALUES ($1,$2,$3,true,true)',
      [`alt2_${process.pid}`, altname, h],
    );
    const r = await ruf(AUTH + '/login', { username: altname, password: PASS });
    assert.equal(r.status, 401, JSON.stringify(r.body));
  });
});
