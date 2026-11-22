/**
 * Daily limit per account: a known address bypasses the brake per account; after 50
 * failed attempts in 24 hours the password therefore only counts together with the code of the
 * second factor. Unknown addresses count together, every known one on its own: a stranger
 * thus does not lock the owner out on the owner's devices. The owner with a factor still gets
 * in, without a factor via „Passwort vergessen“ (that clears the counters); he gets a mail.
 *
 * Counter-checks (measured 14.11.2026, each on its own):
 *   A  in checkCredentials() the query dailyLimitReached() switched off → red: “above the
 *      limit: the password alone is not enough …” (200 instead of 429) and “… with code it continues”
 *   B  in loginFailed() the daily counter not increased → red: “the 50th failed attempt
 *      reaches the limit …” and “above the limit …”
 *   C  the exception for code and active factor deleted → red: “… with code it continues”
 *   D  deleteDailyLimit() deleted in setPasswordBack() → red: “after forgot
 *      password the password works again”
 *
 * Counter-checks for the separation of known addresses (measured 15.11.2026):
 *   E  in _tagKey() always delivered `login-tag|${kennung}` → red: “the 50th failed attempt …”
 *      (the shared counter rose), the two following ones and “50 failed attempts by a
 *      stranger …” (429 instead of 200)
 *   F  in deleteDailyLimit() the deletion with prefix deleted → red: “after forgot
 *      password …” (counter of the known address stayed)
 *
 * Counter-checks for the unlock link (measured 16.11.2026, each on its own):
 *   G  in onlyStillWithFactor() offerRelease() deleted → red: “at an unknown
 *      address an unlock link comes …” (no mail)
 *   H  in _tagKey() the unlock not respected → red: the same check (429 after the link)
 *   I  in approveLogin() the one-time check deleted → red: the same check (the link
 *      counted twice)
 *   J  in approveLogin() the signature not checked → red: the same check (a link for
 *      another account counted)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { environment, testData, buildAndRequire } = require('./helpers/sources');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung', APP_BASE_URL: 'http://localhost' });

const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { mailFake, enterMailServer } = require('./helpers/mail-fake');
const { bis } = require('./helpers/time');
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test.after(() => db.pool.end().catch(() => {}));

test('daily login limit per account', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const gesendet = mailFake();
  t.after(await enterMailServer(db));
  const zf = _req('src/factors/secondFactor.js');
  const { encrypt } = _req('src/infra/secret.js');
  const P = process.pid;
  const OHNE = `tg_ohne_${P}`,
    MIT = `tg_mit_${P}`,
    PASS = 'richtiges-Passwort-17';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[OHNE, MIT]]);
  t.after(() => db.run('DELETE FROM users WHERE username = ANY($1)', [[OHNE, MIT]]).catch(() => {}));
  const id = {};
  for (const n of [OHNE, MIT])
    id[n] = (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
         VALUES ($1, $2, $3, true, true) RETURNING id`,
        [n, `${n}@example.org`, await bcrypt.hash(PASS, 4)],
      )
    ).id;
  const secret = zf.base32(crypto.randomBytes(20));
  await db.run('INSERT INTO second_factor (user_id, secret, active) VALUES ($1, $2, true)', [
    id[MIT],
    encrypt(secret, zf.secondFactorContext(id[MIT])),
  ]);
  /** A fresh code: the same step counts only once, hence reset beforehand. */
  const code = async () => {
    await db.run('UPDATE second_factor SET last_step = 0 WHERE user_id = $1', [id[MIT]]);
    return zf.hotp(zf.fromBase32(secret), zf.timeStep());
  };
  const { base } = testServer(_req, { t });
  const anmelden = async (name, passwort, withCode) => {
    const r = await fetch(`${base}${AUTH}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: name,
        password: passwort,
        without_token: true,
        ...(withCode ? { code: withCode } : {}),
      }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  /** The shared counter of unknown addresses, or with `hier` the one of this known address. */
  const tagKey = async (name, atHere) => {
    if (!atHere) return `login-tag|konto:${id[name]}`;
    const b = await db.get('SELECT key FROM rate_limit_attempts WHERE key LIKE $1', [
      `login-bekannt|%|konto:${id[name]}`,
    ]);
    return `login-tag|konto:${id[name]}|${b.key.split('|')[1]}`;
  };
  const dailyCounter = async (name, atHere) =>
    (await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [await tagKey(name, atHere)]))?.count ?? 0;
  const setCounter = async (name, n, atHere) =>
    db.run(
      `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET count = $2, first_at = NOW(), last_at = NOW()`,
      [await tagKey(name, atHere), n],
    );

  // Both accounts log in once from here: the address is known from now on.
  assert.equal((await anmelden(OHNE, PASS)).status, 200);
  assert.equal((await anmelden(MIT, PASS, await code())).status, 200);

  await t.test('the 50th failed attempt reaches the limit, the owner gets a mail', async () => {
    await setCounter(OHNE, 48, true);
    assert.equal((await anmelden(OHNE, 'falsch-geraten-1')).status, 401);
    assert.equal(await dailyCounter(OHNE, true), 49, 'ein Fehlversuch von einer bekannten Adresse zählt');
    assert.equal(await dailyCounter(OHNE), 0, '… bei dieser Adresse, nicht im gemeinsamen Zähler');
    assert.equal((await anmelden(OHNE, 'falsch-geraten-2')).status, 401);
    assert.equal(await dailyCounter(OHNE, true), 50);
    assert.ok(
      await bis(() => gesendet.some(m => m.to === `${OHNE}@example.org` && /50 fehlgeschlagene/.test(m.text)), 10_000),
      'keine Mail an den Inhaber',
    );
  });

  await t.test('above the limit: the password alone is not enough, even from the known address', async () => {
    const r = await anmelden(OHNE, PASS);
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.equal(r.body.code, 'account_daily_limit');
    assert.equal(r.body.second_factor, true, 'die Oberfläche bietet das Codefeld an');
    // Without a factor even a code does not help; the response does not reveal the password.
    assert.equal((await anmelden(OHNE, PASS, '123456')).body.code, 'account_daily_limit');
    assert.equal((await anmelden(OHNE, 'falsch', '123456')).body.code, 'account_daily_limit');
  });

  await t.test('… with code it continues, without not', async () => {
    await setCounter(MIT, 50, true);
    assert.equal((await anmelden(MIT, PASS)).body?.code, 'account_daily_limit');
    const r = await anmelden(MIT, PASS, await code());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await anmelden(MIT, 'falsch-geraten', await code())).status, 401);
  });

  await t.test('after forgot password the password works again', async () => {
    const link = `tg-link-${P}`;
    await db.run(`UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2`, [
      _req('src/account/deviceToken.js').tokenDigest(link),
      id[OHNE],
    ]);
    const neu = 'neues-Passwort-nach-Link-17';
    const r = await fetch(`${base}${AUTH}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: link, password: neu }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual([await dailyCounter(OHNE), await dailyCounter(OHNE, true)], [0, 0]);
    assert.equal((await anmelden(OHNE, neu)).status, 200);
  });

  await t.test('50 failed attempts by a stranger do not lock the known address, an unknown one is locked', async () => {
    const neu = 'neues-Passwort-nach-Link-17';
    await setCounter(OHNE, 50);
    const r = await anmelden(OHNE, neu);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Without a known row the same address is foreign: there the shared counter applies.
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`login-bekannt|%|konto:${id[OHNE]}`]);
    assert.equal((await anmelden(OHNE, neu)).body?.code, 'account_daily_limit');
  });

  await t.test('at an unknown address an unlock link comes; it unlocks it, once', async () => {
    const neu = 'neues-Passwort-nach-Link-17';
    const links = () =>
      gesendet
        .filter(m => m.to === `${OHNE}@example.org`)
        .map(m => /\/anmeldung-freigeben#token=(\S+)/.exec(m.text)?.[1])
        .filter(Boolean);
    assert.ok(await bis(() => links().length > 0, 10_000), 'kein Freigabelink an den Inhaber');
    assert.equal((await anmelden(OHNE, 'falsch-noch-einmal')).body?.code, 'account_daily_limit');
    assert.equal(await bis(() => links().length > 1, 300), false, 'je Adresse und Stunde nur eine Mail');
    const freigeben = token =>
      fetch(`${base}${AUTH}/approve-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    const [token] = links();
    const [uid, ...rest] = token.split('.');
    const forged = [String(id[MIT]), ...rest].join('.');
    assert.equal((await freigeben(forged)).body.code, 'approval_link_invalid', 'Signatur');
    assert.equal(Number(uid), id[OHNE]);
    const r = await freigeben(token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await freigeben(token)).body.code, 'approval_link_invalid', 'nur einmal');
    const a = await anmelden(OHNE, neu);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(await dailyCounter(OHNE), 50, 'der gemeinsame Zähler bleibt für andere Adressen');
  });
});
