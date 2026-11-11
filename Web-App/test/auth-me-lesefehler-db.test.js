/**
 * GET /auth/me bei einem Lesefehler: 503 statt „nicht angemeldet“ oder 401.
 * Mit 401 verwürfe die App ihren Token, und der Browser zeigte die
 * Anmeldemaske, obwohl die Sitzung gilt. Der Fehler kommt aus dem Pool, wie
 * bei einer abgerissenen Verbindung; der Rest läuft echt.
 *
 * Gegenprobe (11.11.2026 gemessen): der frühere catch-Zweig (Token → 401
 * token_ungueltig, sonst 200 loggedIn: false) → rot in beiden Teiltests.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const auth = _req('src/konto/auth.js');

test('/auth/me bei einem Lesefehler', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const NAME = `me_lesefehler_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  const token = await auth.createToken(uid, 'Lesefehler', false, null, { scope: 'app' });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const sitzung = {};
  const { base } = testServer(_req, { sitzung, routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const me = async (kopf = {}) => {
    const r = await fetch(`${base}/api/v1/auth/me`, { headers: kopf });
    return { status: r.status, body: await r.json() };
  };
  /** Jede Abfrage scheitert, solange `arbeit` läuft. */
  const mitFehler = async arbeit => {
    const echt = db.pool.query;
    db.pool.query = async () => {
      throw new Error('Verbindung zur Datenbank verloren');
    };
    try {
      return await arbeit();
    } finally {
      db.pool.query = echt;
    }
  };

  await t.test('mit Sitzung: 503 statt „nicht angemeldet“', async () => {
    Object.assign(sitzung, { userId: uid, username: NAME });
    assert.equal((await me()).body.loggedIn, true, 'Vorbedingung: ohne Fehler angemeldet');
    const r = await mitFehler(() => me());
    assert.deepEqual([r.status, r.body.code, r.body.loggedIn], [503, 'server_ausgelastet', undefined]);
    for (const k of Object.keys(sitzung)) delete sitzung[k];
  });

  await t.test('mit Token: 503 statt 401', async () => {
    const kopf = { authorization: `Bearer ${token}` };
    assert.equal((await me(kopf)).body.loggedIn, true, 'Vorbedingung: ohne Fehler angemeldet');
    auth.leereTokenCache();
    const r = await mitFehler(() => me(kopf));
    assert.deepEqual([r.status, r.body.code], [503, 'server_ausgelastet']);
  });
});
