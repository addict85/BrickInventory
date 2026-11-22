/**
 * Token families: a replaced token stays as „verbraucht“. If it comes
 * back after the grace period (use or exchange), somebody has copied it:
 * the whole family ends including the successor, the owner gets a mail.
 * Other devices of the same account stay logged in.
 *
 * Counter-checks (measured 03.11.2026, each on its own):
 *   A  in endOverlap() only delete, not mark → red:
 *      “the predecessor is marked as used”
 *   B  reportReuse() not called in checkToken() → red:
 *      “the exchange with the used one locks the family” (B still applies)
 *   C  in lockFamily() `a.created_at = v.token_family` deleted → red:
 *      “the other device stays logged in”
 *   D  hintInBackground() removed in reportReuse() → red:
 *      “the owner gets exactly one mail”
 *   E  REUSE_GRACE_PERIOD_S set to 0 → red: “a straggler in the
 *      grace period locks nothing”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const gesendet = [];
require('./helpers/sources').replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, kind, o) => {
    gesendet.push({ an, kind, name: o.passkey });
    return { success: true };
  },
});

const db = S.testData();
const auth = _req('src/account/deviceToken.js');
const tokenCache = _req('src/account/tokenCache.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const NAME = `familie_${process.pid}`,
  PASS = 'Familien-Passwort-1';

test('token family with reuse detection', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@example.org`, await bcrypt.hash(PASS, 4)],
    )
  ).id;

  const app = express();
  app.use(express.json());
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2/auth', require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}/api/v2/auth`;
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const ruf = async (weg, token, body) => {
    const r = await fetch(basis + weg, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const anmelden = async label => {
    const r = await ruf('/login', null, { username: NAME, password: PASS, label, never_expires: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.token;
  };
  const gilt = async token => {
    tokenCache.emptyTokenCache();
    return (await ruf('/me', token)).status === 200;
  };
  const verbraucht = async () =>
    (await db.all('SELECT token FROM api_tokens_consumed WHERE user_id = $1', [uid])).map(z => z.token);
  // Every login reports its new access (token_added); here the warning is counted.
  const warnings = () => gesendet.filter(m => m.an === `${NAME}@example.org` && m.kind !== 'token_added');
  const mails = async count => {
    for (let i = 0; i < 60 && warnings().length < count; i++) await new Promise(r => setTimeout(r, 25));
    return warnings();
  };

  const a = await anmelden('Pixel');
  const anderes = await anmelden('Tablet');
  const getauscht = await ruf('/rotate-token', a, {});
  assert.equal(getauscht.status, 200, JSON.stringify(getauscht.body));
  const b = getauscht.body.token;

  await t.test('the predecessor is marked as used', async () => {
    assert.equal(await gilt(b), true, 'die erste Nutzung des Nachfolgers');
    assert.deepEqual(await verbraucht(), [auth.tokenDigest(a)]);
    assert.equal(await gilt(a), false, 'der Vorgänger gilt nach der Überlappung nicht mehr');
  });

  await t.test('a straggler in the grace period locks nothing', async () => {
    assert.equal((await ruf('/rotate-token', a, {})).status, 401);
    assert.equal(await gilt(b), true, 'eine Anfrage, die noch mit dem alten unterwegs war, sperrt das Gerät aus');
    assert.deepEqual(await mails(0), []);
  });

  await t.test('the exchange with the used one locks the family', async () => {
    await db.run(`UPDATE api_tokens_consumed SET consumed_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1`, [uid]);
    assert.equal((await ruf('/rotate-token', a, {})).status, 401);
    assert.equal(await gilt(b), false, 'der Nachfolger des kopierten Tokens gilt weiter');
    assert.deepEqual(await verbraucht(), [], 'die Familie ist samt Vermerk weg');
  });

  await t.test('the other device stays logged in', async () => {
    assert.equal(await gilt(anderes), true);
  });

  await t.test('the owner gets exactly one mail', async () => {
    assert.deepEqual(await mails(1), [{ an: `${NAME}@example.org`, kind: 'token_reused', name: 'Pixel' }]);
    assert.equal((await ruf('/me', a)).status, 401);
    await new Promise(r => setTimeout(r, 100));
    assert.equal((await mails(1)).length, 1, 'ein zweiter Versuch schickt keine zweite Mail');
  });

  await t.test('orphaned marks are cleared by the background run', async () => {
    const c2 = await ruf('/rotate-token', anderes, {});
    assert.equal(await gilt(c2.body.token), true);
    assert.equal((await verbraucht()).length, 1, 'Vorbedingung: ein Vermerk der lebenden Familie');
    await auth.tokensCleanup();
    assert.equal((await verbraucht()).length, 1, 'der Vermerk einer lebenden Familie bleibt');
    await db.run('DELETE FROM api_tokens WHERE user_id = $1', [uid]);
    await auth.tokensCleanup();
    assert.deepEqual(await verbraucht(), []);
  });
});
