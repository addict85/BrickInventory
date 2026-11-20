/**
 * Verwalterrechte verlangen einen zweiten Faktor: Ein Verwalter ohne TOTP und
 * ohne Passkey kommt nach der Anmeldung nur bis zu dessen Einrichtung (403
 * zweiter_faktor_pflicht), Anmeldung und /auth/me sagen es der Oberfläche.
 * Ein gewöhnliches Konto und ein App-Token (Scope `app`) eines Verwalters sind …
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  in loginAtInbox die Prüfung zweiterFaktorPflicht gestrichen → rot:
 *      „ohne zweiten Faktor nur dessen Einrichtung“, „… App-Token …“ (der volle
 *      Token kommt durch) und „ein Passkey genügt“
 *   B  /zweiter-faktor/einrichten aus TO_SETUP gestrichen → rot:
 *      „… die Einrichtung geht, danach alles“
 *   C  zweiterFaktorPflicht() zählt auch Passkeys (hatPasskeys) → rot: „ein
 *      Passkey allein genügt nicht“
 *   D  in signedInResponses `zweiterFaktorPflicht` immer false → rot:
 *      „Anmeldung und /auth/me nennen die Pflicht“
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const zf = _req('src/factors/secondFactor.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const { portOf } = require('./helpers/server');
const PASS = 'Verwalter-Passwort-1';

/** Wie server.ts: Eingang vor den Routen; die Sitzung steht fest. */
function server(t, sitzung, token) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    /** @type {any} */ (req).session = Object.assign(sitzung, {
      save: cb => cb?.(),
      regenerate: cb => cb?.(),
      destroy: cb => cb?.(),
    });
    next();
  });
  app.use(
    '/api/v1',
    _req('routes/api_v1/middleware.js').guardFor(require('./helpers/sources').testServices().account).loginAtInbox,
  );
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
  app.use('/api/v1/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  // Wie startup/app.ts: ein Fehlerweg hinter allem, auch hinter dem Eingang.
  app.use(_req('src/http/httpAntwort.js').errorResponse);
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const base = `http://localhost:${portOf(srv)}/api/v1`;
  return async (methode, weg, body) => {
    const r = await fetch(base + weg, {
      method: methode,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}

test('zweiter Faktor für Verwalter', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const P = process.pid,
    NAMEN = [`zfp_chef_${P}`, `zfp_nutzer_${P}`, `zfp_pk_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const konto = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [name, `${name}@example.org`, await bcrypt.hash(PASS, 4), admin],
      )
    ).id;
  const chef = await konto(NAMEN[0], true),
    nutzer = await konto(NAMEN[1], false),
    withPk = await konto(NAMEN[2], true);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

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
    assert.equal(
      (await server(t, { userId: nutzer, username: NAMEN[1], isAdmin: false })('GET', '/settings')).status,
      200,
    );
    const { createToken } = _req('src/account/deviceToken.js');
    const app = server(t, {}, await createToken(chef, 'app', false, null, { scope: 'app' }));
    assert.equal((await app('GET', '/settings')).status, 200);
    const voll = server(t, {}, await createToken(chef, 'voll', false, null, { scope: 'voll' }));
    assert.equal((await voll('GET', '/settings')).status, 403);
  });

  await t.test('… die Einrichtung geht, danach alles', async () => {
    const e = await alsChef('POST', '/auth/zweiter-faktor/einrichten', { password: PASS });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    const code = zf.hotp(zf.fromBase32(e.body.geheimnis), zf.timeStep());
    const b = await alsChef('POST', '/auth/zweiter-faktor/bestaetigen', { code });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal((await alsChef('GET', '/settings')).status, 200);
    assert.equal((await alsChef('GET', '/auth/me')).body.user.zweiterFaktorPflicht, false);
  });

  await t.test('ein Passkey allein genügt nicht', async () => {
    const pk = server(t, { userId: withPk, username: NAMEN[2], isAdmin: true });
    await db.run(`INSERT INTO passkeys (user_id, credential_id, public_key) VALUES ($1, $2, '\\x00')`, [
      withPk,
      `pk-${P}`,
    ]);
    assert.equal((await pk('GET', '/settings')).status, 403);
  });
});
