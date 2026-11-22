/**
 * The periods of the web app session in the real app (startup/app.ts): the
 * store gets the idle period, the cookie stays a session cookie,
 * and the maximum duration applies behind the session.
 *
 * Counter-checks (measured 11.11.2026, each on its own):
 *   A  `ttl: SESSION_IDLE_SEC` deleted in startup/app.ts → red: “the
 *      store gets the idle period” (connect-pg-simple sets one day)
 *   B  `app.use(sessionMaxDuration())` deleted in startup/app.ts → red:
 *      “after the maximum duration nobody is logged in anymore”
 *   C  `maxAge: 3_600_000` in sessionCookieOptions() → red: “the cookie …” (and
 *      “the store …”: maxAge also determines its period)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const bcrypt = require('bcryptjs');
const db = testData();

test('session periods in the real app', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
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

  const { buildApp } = _req('startup/app.js');
  const app = buildApp({
    pool: db.systemPool,
    config: _req('src/infra/config.js').config(),
    sessionSecret: 'p'.repeat(48),
    dienste: require('./helpers/sources').testServices(),
  });
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://localhost:${srv.address().port}`;
  const SESSION_IDLE_SEC = _req('src/account/sessionDeadline.js').sessionIdleSec(_req('src/infra/config.js').config());

  const r = await fetch(`${basis}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: basis },
    body: JSON.stringify({ username: NAME, password: PASS, without_token: true }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const setCookie = r.headers.get('set-cookie') ?? '';
  const keks = setCookie.split(';')[0];
  const wer = async () =>
    (await (await fetch(`${basis}/api/v2/auth/me`, { headers: { cookie: keks } })).json()).loggedIn;
  const row = () =>
    db.get(
      `SELECT sid, EXTRACT(EPOCH FROM (expire - NOW()))::int AS rest FROM user_sessions WHERE sess::jsonb->>'userId' = $1`,
      [String(uid)],
    );

  await t.test('the store gets the idle period', async () => {
    assert.equal(await wer(), true, 'Vorbedingung: angemeldet');
    const z = await row();
    assert.ok(z, 'keine Sitzung in user_sessions');
    assert.ok(Math.abs(z.rest - SESSION_IDLE_SEC) < 120, `Restlaufzeit ${z.rest} s statt ${SESSION_IDLE_SEC} s`);
  });

  await t.test('the cookie does not survive the browser', () => {
    assert.doesNotMatch(setCookie, /;\s*(Max-Age|Expires)=/i, setCookie);
  });

  await t.test('after the maximum duration nobody is logged in anymore', async () => {
    const { sid } = await row();
    await db.run(`UPDATE user_sessions SET sess = jsonb_set(sess::jsonb, '{angemeldetAm}', '1')::json WHERE sid = $1`, [
      sid,
    ]);
    assert.equal(await wer(), false);
  });
});
