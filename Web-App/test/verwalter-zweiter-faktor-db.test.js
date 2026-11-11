/**
 * Verwalterrechte verlangen einen zweiten Faktor: Ein Verwalter ohne TOTP und
 * ohne Passkey kommt nach der Anmeldung nur bis zu dessen Einrichtung (403
 * zweiter_faktor_pflicht), Anmeldung und /auth/me sagen es der Oberfläche.
 * Ein gewöhnliches Konto und ein App-Token (Scope `app`) eines Verwalters sind …
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  in anmeldungAmEingang die Prüfung zweiterFaktorPflicht gestrichen → rot:
 *      „ohne zweiten Faktor nur dessen Einrichtung“, „… App-Token …“ (der volle
 *      Token kommt durch) und „ein Passkey genügt“
 *   B  /zweiter-faktor/einrichten aus ZUR_EINRICHTUNG gestrichen → rot:
 *      „… die Einrichtung geht, danach alles“
 *   C  zweiterFaktorPflicht() zählt auch Passkeys (hatPasskeys) → rot: „ein
 *      Passkey allein genügt nicht“
 *   D  in angemeldetAntworten `zweiterFaktorPflicht` immer false → rot:
 *      „Anmeldung und /auth/me nennen die Pflicht“
 *
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const zf = _req('src/konto/zweiterFaktor.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Verwalter-Passwort-1';

/** Wie server.ts: Eingang vor den Routen; die Sitzung steht fest. */
function server(t, sitzung, token) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = Object.assign(sitzung, { save: (cb) => cb?.(), regenerate: (cb) => cb?.(), destroy: (cb) => cb?.() });
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/middleware.js').anmeldungAmEingang);
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  app.use('/api/v1/auth', _req('routes/auth.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const base = `http://localhost:${srv.address().port}/api/v1`;
  return async (methode, weg, body) => {
    const r = await fetch(base + weg, { method: methode,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}

test('zweiter Faktor für Verwalter', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber keine Test-DB: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }
  const P = process.pid, NAMEN = [`zfp_chef_${P}`, `zfp_nutzer_${P}`, `zfp_pk_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const konto = async (name, admin) => (await db.get(`INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`, [name, `${name}@example.org`, await bcrypt.hash(PASS, 4), admin])).id;
  const chef = await konto(NAMEN[0], true), nutzer = await konto(NAMEN[1], false), mitPk = await konto(NAMEN[2], true);
  t.after(async () => { await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {}); await db.pool.end().catch(() => {}); });

  const alsChef = server(t, { userId: chef, username: NAMEN[0], isAdmin: true });

  await t.test('Anmeldung und /auth/me nennen die Pflicht', async () => {
    const anonym = server(t, {});
    const voll = await anonym('POST', '/auth/login', { username: NAMEN[0], password: PASS, scope: 'voll' });
    assert.equal(voll.status, 200, JSON.stringify(voll.body));
    assert.equal(voll.body.user.zweiterFaktorPflicht, true);
    const app = await anonym('POST', '/auth/login', { username: NAMEN[0], password: PASS });
    assert.equal(app.body.user.zweiterFaktorPflicht, false, 'ein App-Token trägt keine Verwalterrechte');
    assert.equal((await alsChef('GET', '/auth/me')).body.user.zweiterFaktorPflicht, true);
  });

  await t.test('ohne zweiten Faktor nur dessen Einrichtung', async () => {
    const r = await alsChef('GET', '/settings');
    assert.deepEqual([r.status, r.body.code], [403, 'zweiter_faktor_pflicht']);
    assert.equal((await alsChef('GET', '/auth/users')).status, 403);
    assert.equal((await alsChef('GET', '/auth/zweiter-faktor')).status, 200);
  });

  await t.test('ein gewöhnliches Konto und ein App-Token sind nicht betroffen', async () => {
    assert.equal((await server(t, { userId: nutzer, username: NAMEN[1], isAdmin: false })('GET', '/settings')).status, 200);
    const { createToken } = _req('src/konto/auth.js');
    const app = server(t, {}, await createToken(chef, 'app', false, null, { scope: 'app' }));
    assert.equal((await app('GET', '/settings')).status, 200);
    const voll = server(t, {}, await createToken(chef, 'voll', false, null, { scope: 'voll' }));
    assert.equal((await voll('GET', '/settings')).status, 403);
  });

  await t.test('… die Einrichtung geht, danach alles', async () => {
    const e = await alsChef('POST', '/auth/zweiter-faktor/einrichten', { password: PASS });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    const code = zf.hotp(zf.ausBase32(e.body.geheimnis), zf.zeitschritt());
    const b = await alsChef('POST', '/auth/zweiter-faktor/bestaetigen', { code });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal((await alsChef('GET', '/settings')).status, 200);
    assert.equal((await alsChef('GET', '/auth/me')).body.user.zweiterFaktorPflicht, false);
  });

  await t.test('ein Passkey allein genügt nicht', async () => {
    const pk = server(t, { userId: mitPk, username: NAMEN[2], isAdmin: true });
    await db.run(`INSERT INTO passkeys (user_id, credential_id, public_key) VALUES ($1, $2, '\\x00')`, [mitPk, `pk-${P}`]);
    assert.equal((await pk('GET', '/settings')).status, 403);
  });
});
