/**
 * The brakes of re-confirmation: wrong codes count in their own
 * counter that only a correct code resets (report M2). Both counters
 * apply per access — session or token family — so that failed attempts from
 * a captured session do not lock the owner's emergency brakes (N1).
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  in checkConfirmation the code checked via the brake 'passwort'
 *      (shared counter that the correct password clears) → red:
 *      “the password does not reset the code counter" and “wrong codes
 *      of a foreign session …" (the attacker is never locked)
 *   B  accessOf() always returns '' (counter per account, as before) → red:
 *      “a foreign session does not lock the emergency brakes" and “wrong codes
 *      of a foreign session do not lock the owner"
 *   C  accessOf() takes the head instead of created_at for tokens → red: “the
 *      exchange of the token does not reset the brake"
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const zf = _req('src/factors/secondFactor.js');
const { createToken } = _req('src/account/deviceToken.js');
const { decrypt } = _req('src/infra/secret.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Bremsen-Passwort-1';

async function konto(name) {
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  return (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [name, `${name}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
}

test('brakes of the confirmation', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `bb_${process.pid}`,
    KARL = `bb_karl_${process.pid}`;
  const uid = await konto(NAME),
    karl = await konto(KARL);
  const leeren = () =>
    db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1 OR key LIKE $2', [
      `%-bestaetigen|${uid}|%`,
      `%-bestaetigen|${karl}|%`,
    ]);
  t.after(async () => {
    await leeren().catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, karl]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await zf.beginSetup(uid);
  const z = await db.get('SELECT secret FROM second_factor WHERE user_id = $1', [uid]);
  const codes = await zf.confirmSetup(
    uid,
    zf.hotp(zf.fromBase32(decrypt(z.secret, zf.secondFactorContext(uid))), zf.timeStep()),
  );
  let naechster = 0;
  const richtig = () => codes[naechster++];

  // Per header `x-sitzung` its own session (as express-session provides it), without it a token.
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const sid = req.headers['x-sitzung'];
    req.session = sid ? { userId: Number(req.headers['x-konto'] ?? uid), username: NAME } : {};
    if (sid) req.sessionID = String(sid);
    next();
  });
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const base = `http://localhost:${srv.address().port}`;
  const callFn = async (methode, weg, body, kopf) => {
    const r = await fetch(base + weg, {
      method: methode,
      headers: { 'content-type': 'application/json', ...kopf },
      body: JSON.stringify(body),
    });
    return { status: r.status, code: (await r.json().catch(() => ({}))).code };
  };
  const A = { 'x-sitzung': 'sitzung-angreifer' },
    O = { 'x-sitzung': 'sitzung-inhaber' };
  const passkeyDelete = (code, kopf = A) =>
    callFn('DELETE', '/api/v2/auth/passkeys/999999', { password: PASS, code }, kopf);

  await t.test('the password does not reset the code counter', async () => {
    await leeren();
    // Every attempt carries the correct password; in between the former reset path (password without code).
    for (let i = 0; i < 4; i++) assert.equal((await passkeyDelete(String(100000 + i))).code, 'second_factor_wrong');
    assert.equal(
      (await callFn('POST', '/api/v2/auth/second-factor/setup', { password: PASS }, A)).code,
      'second_factor_required',
    );
    assert.equal((await passkeyDelete('100004')).code, 'second_factor_wrong');
    const sixth = await passkeyDelete(richtig());
    assert.equal(sixth.status, 429, `das Passwort setzt den Codezähler zurück: ${JSON.stringify(sixth)}`);
  });

  await t.test('a correct code resets it', async () => {
    await leeren();
    for (let i = 0; i < 4; i++) await passkeyDelete(String(200000 + i));
    assert.equal((await passkeyDelete(richtig())).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await passkeyDelete(String(210000 + i))).code, 'second_factor_wrong');
  });

  await t.test('a foreign session does not lock the emergency brakes', async () => {
    await leeren();
    const kopf = { 'x-sitzung': 'karl-fremd', 'x-konto': String(karl) };
    for (let i = 0; i < 5; i++)
      await callFn('POST', '/api/v2/settings/sessions/end-others', { password: `falsch${i}` }, kopf);
    assert.equal(
      (await callFn('POST', '/api/v2/settings/sessions/end-others', { password: PASS }, kopf)).status,
      429,
      'Vorbedingung: die fremde Sitzung ist gesperrt',
    );
    const eigen = { 'x-sitzung': 'karl-eigen', 'x-konto': String(karl) };
    assert.equal(
      (await callFn('POST', '/api/v2/settings/sessions/end-others', { password: PASS }, eigen)).status,
      200,
      'eine fremde Sitzung sperrt die Notbremsen',
    );
    const wechsel = await callFn(
      'POST',
      '/api/v2/auth/change-password',
      { current: PASS, newPassword: 'Neues-Passwort-77' },
      eigen,
    );
    assert.equal(wechsel.status, 200, `eine fremde Sitzung sperrt die Notbremsen: ${JSON.stringify(wechsel)}`);
    await db.run('UPDATE users SET password_hash = $2 WHERE id = $1', [karl, await bcrypt.hash(PASS, 4)]);
  });

  await t.test('wrong codes of a foreign session do not lock out the owner', async () => {
    await leeren();
    for (let i = 0; i < 5; i++) await passkeyDelete(String(300000 + i), A);
    assert.equal((await passkeyDelete(richtig(), A)).status, 429, 'Vorbedingung: Angreifer gesperrt');
    assert.equal(
      (await passkeyDelete(richtig(), O)).status,
      200,
      'falsche Codes einer fremden Sitzung sperren den Inhaber',
    );
  });

  await t.test('swapping the token does not reset the brake', async () => {
    await leeren();
    const token = await createToken(karl, 'Probe', true);
    const mit = tk => ({ authorization: `Bearer ${tk}` });
    for (let i = 0; i < 5; i++) await callFn('DELETE', '/api/v2/inventory', { password: `falsch${i}` }, mit(token));
    assert.equal(
      (await callFn('DELETE', '/api/v2/inventory', { password: PASS }, mit(token))).status,
      429,
      'Vorbedingung',
    );
    const r = await fetch(`${base}/api/v2/auth/rotate-token`, { method: 'POST', headers: mit(token) });
    const neu = (await r.json()).token;
    assert.ok(neu, 'Vorbedingung: getauscht');
    assert.equal(
      (await callFn('DELETE', '/api/v2/inventory', { password: PASS }, mit(neu))).status,
      429,
      'der Tausch des Tokens setzt die Bremse zurück',
    );
  });
});
