/**
 * Die Fristen der Webapp-Sitzung in der echten App (startup/app.ts): Der
 * Speicher bekommt die Leerlauffrist, das Cookie bleibt ein Sitzungs-Cookie,
 * und die Höchstdauer greift hinter der Sitzung.
 *
 * Gegenproben (11.11.2026 gemessen, je einzeln):
 *   A  `ttl: SITZUNG_LEERLAUF_SEK` in startup/app.ts gestrichen → rot: „der
 *      Speicher bekommt die Leerlauffrist“ (connect-pg-simple setzt einen Tag)
 *   B  `app.use(sitzungsHoechstdauer())` in startup/app.ts gestrichen → rot:
 *      „nach der Höchstdauer ist niemand mehr angemeldet“
 *   C  `maxAge: 3_600_000` in sitzungsKeksOptionen() → rot: „das Cookie …“ (und
 *      „der Speicher …“: maxAge bestimmt auch dessen Frist)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const bcrypt = require('bcryptjs');
const db = testDaten();

test('Sitzungsfristen in der echten App', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const NAME = `sitzapp_${process.pid}`,
    PASS = 'Sitzung-in-der-App-1';
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const { baueApp } = _req('startup/app.js');
  const app = baueApp({
    pool: db.systemPool,
    konfig: _req('src/infra/konfig.js').konfig(),
    sitzungsGeheimnis: 'p'.repeat(48),
    dienste: require('./helpers/sources').testDienste(),
  });
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://localhost:${srv.address().port}`;
  const { SITZUNG_LEERLAUF_SEK } = _req('src/konto/sitzungsFrist.js');

  const r = await fetch(`${basis}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: basis },
    body: JSON.stringify({ username: NAME, password: PASS, ohne_token: true }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const setCookie = r.headers.get('set-cookie') ?? '';
  const keks = setCookie.split(';')[0];
  const wer = async () =>
    (await (await fetch(`${basis}/api/v1/auth/me`, { headers: { cookie: keks } })).json()).loggedIn;
  const zeile = () =>
    db.get(
      `SELECT sid, EXTRACT(EPOCH FROM (expire - NOW()))::int AS rest FROM user_sessions WHERE sess::jsonb->>'userId' = $1`,
      [String(uid)],
    );

  await t.test('der Speicher bekommt die Leerlauffrist', async () => {
    assert.equal(await wer(), true, 'Vorbedingung: angemeldet');
    const z = await zeile();
    assert.ok(z, 'keine Sitzung in user_sessions');
    assert.ok(
      Math.abs(z.rest - SITZUNG_LEERLAUF_SEK) < 120,
      `Restlaufzeit ${z.rest} s statt ${SITZUNG_LEERLAUF_SEK} s`,
    );
  });

  await t.test('das Cookie überlebt den Browser nicht', () => {
    assert.doesNotMatch(setCookie, /;\s*(Max-Age|Expires)=/i, setCookie);
  });

  await t.test('nach der Höchstdauer ist niemand mehr angemeldet', async () => {
    const { sid } = await zeile();
    await db.run(`UPDATE user_sessions SET sess = jsonb_set(sess::jsonb, '{angemeldetAm}', '1')::json WHERE sid = $1`, [
      sid,
    ]);
    assert.equal(await wer(), false);
  });
});
