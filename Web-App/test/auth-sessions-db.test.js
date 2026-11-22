/**
 * Password change against a real database and a real session store.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { takeoverNow } = require('./helpers/admin');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
// READ the address from server.ts, do not copy it: a separate test bench
// with a fixed address stays green while the router hangs elsewhere long ago.
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test('a password change ends sessions AND tokens — against a real store', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  // ── Setup: an administrator, a victim ───────────────────────────────────
  for (const name of ['pw_chef', 'pw_opfer']) {
    await db.run('DELETE FROM users WHERE username = $1', [name]);
  }
  const hash = await bcrypt.hash('altesPasswort1', 4);
  await db.run('INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,true,true)', [
    'pw_chef',
    hash,
  ]);
  await db.run('INSERT INTO users (username,password_hash,is_admin,email_verified) VALUES ($1,$2,false,true)', [
    'pw_opfer',
    hash,
  ]);
  const victimId = (await db.get("SELECT id FROM users WHERE username='pw_opfer'")).id;

  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: _req('src/account/sessionStore.js').hashSessionIds(
        new pgSession({ pool: db.pool, tableName: 'user_sessions' }),
      ),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js'));
  const srv = app.listen(0);
  const basis = `http://localhost:${srv.address().port}`;

  // Password as a parameter, NOT hard-wired: the second subtest changes
  // the administrator's password — with a fixed 'altesPasswort1' the next
  // login fails, and the third subtest would be red for a reason that
  // has nothing to do with the checked rule.
  const anmelden = async (user, passwort) => {
    const r = await fetch(`${basis}${AUTH}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password: passwort, without_token: true }),
    });
    const body = await r.json();
    assert.equal(body.success, true, `Sign-in ${user} failed: ${JSON.stringify(body)}`);
    return { cookie: (r.headers.get('set-cookie') || '').split(';')[0], body };
  };
  const angemeldet = async cookie =>
    (await fetch(`${basis}${AUTH}/me`, { headers: { cookie } }).then(r => r.json())).loggedIn === true;
  const sitzungen = async uid =>
    (await db.get("SELECT COUNT(*)::int n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])).n;

  try {
    await t.test('the admin reset throws out the taken-over window', async () => {
      const angreifer = await anmelden('pw_opfer', 'altesPasswort1');
      const chef = await anmelden('pw_chef', 'altesPasswort1');
      assert.equal(await angemeldet(angreifer.cookie), true, 'Precondition: session exists');
      assert.ok((await sitzungen(victimId)) >= 1, 'Precondition: session is in user_sessions');

      const r = await fetch(`${basis}${AUTH}/users/${victimId}/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: chef.cookie },
        body: JSON.stringify({ password: 'neuesPasswort1', admin_password: 'altesPasswort1' }),
      });
      assert.equal(r.status, 200, await r.text());
      // Announced (src/account/adminActions.ts); what counts here is what follows on taking effect.
      assert.equal(await takeoverNow(_req, db, victimId), 1);

      // THE point of the file: the session is really gone, not just “the DELETE
      // is in the code".
      assert.equal(await sitzungen(victimId), 0, 'Sessions of the account must end');
      assert.equal(await angemeldet(angreifer.cookie), false, 'The old window must not stay signed in after the reset');
    });

    await t.test('the own password change throws out the other windows — not the own one', async () => {
      // Two windows of the same account: one changes the password, the other
      // must be out. The changing window stays in (fresh
      // session ID via establishSession) — otherwise one would throw oneself out.
      const windowA = await anmelden('pw_chef', 'altesPasswort1');
      const windowB = await anmelden('pw_chef', 'altesPasswort1');
      assert.equal(await angemeldet(windowB.cookie), true, 'Precondition: second window open');

      const r = await fetch(`${basis}${AUTH}/change-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: windowA.cookie },
        body: JSON.stringify({ current: 'altesPasswort1', newPassword: 'nochNeuer1234' }),
      });
      assert.equal(r.status, 200, await r.text());

      assert.equal(
        await angemeldet(windowB.cookie),
        false,
        'The other window must be signed out after the password change',
      );
      // The own window: the session ID was renewed, the old cookie is
      // thereby invalidated too — desired (session fixation) and the reason
      // why the response sends a new cookie along.
      assert.ok(r.headers.get('set-cookie'), 'After the rotation a new session cookie must come back');
    });

    await t.test('bearer tokens of the account expire along with it', async () => {
      const { tokenDigest, userForToken } = _req('src/account/deviceToken.js');
      const crypto = require('node:crypto');
      const tok = crypto.randomBytes(16).toString('hex');
      await db.run("INSERT INTO api_tokens (token,user_id,label,expires_at) VALUES ($1,$2,'app',NULL)", [
        tokenDigest(tok),
        victimId,
      ]);
      assert.ok(await userForToken(tok), 'Vorbedingung: Token gilt');

      // 'nochNeuer1234' — the subtest before changed it.
      const chef = await anmelden('pw_chef', 'nochNeuer1234');
      // The VICTIM's password was changed in the first subtest — here all that counts is that
      // the reset runs; the admin path requires no old password.
      const r = await fetch(`${basis}${AUTH}/users/${victimId}/password`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: chef.cookie },
        body: JSON.stringify({ password: 'wiederNeu123', admin_password: 'nochNeuer1234' }),
      });
      assert.equal(r.status, 200, await r.text());
      assert.equal(await takeoverNow(_req, db, victimId), 1);
      assert.equal(await userForToken(tok), null, 'A token on another device must not survive the password change');
    });

    // Counter-check (measured 11.11.2026): in setPasswordBack (src/account/accounts.ts)
    // `await endAccesses(uid)` deleted → red here (session and token stay).
    await t.test('resetting via link ends sessions and tokens', async () => {
      const { tokenDigest, createToken, userForToken } = _req('src/account/deviceToken.js');
      const fenster = await anmelden('pw_opfer', 'wiederNeu123');
      const tok = await createToken(victimId, 'Fremdgerät', true);
      const roh = 'd'.repeat(64);
      await db.run(`UPDATE users SET reset_token = $2, reset_token_expires = NOW() + interval '1 hour' WHERE id = $1`, [
        victimId,
        tokenDigest(roh),
      ]);
      await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'reset-password|%'");
      const r = await fetch(`${basis}${AUTH}/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: roh, password: 'perLinkGesetzt12' }),
      });
      assert.equal(r.status, 200, await r.text());
      assert.equal(await sitzungen(victimId), 0, 'Sessions of the account must end');
      assert.equal(await angemeldet(fenster.cookie), false);
      assert.equal(await userForToken(tok), null, 'The token must not survive the reset');
    });

    // Counter-check (measured 11.11.2026): in PUT /users/:id/password the check
    // `targetId === nutzerId(req)` deleted → red “… not for the own account” (200).
    await t.test('the admin path does not apply to the own account and not to unknown ones', async () => {
      const chef = await anmelden('pw_chef', 'nochNeuer1234');
      const chefId = (await db.get("SELECT id FROM users WHERE username='pw_chef'")).id;
      const put = async (cookie, id) => {
        const r = await fetch(`${basis}${AUTH}/users/${id}/password`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ password: 'Verwalter-Setzt-99', admin_password: 'nochNeuer1234' }),
        });
        return `${r.status} ${(await r.json()).code ?? ''}`;
      };
      assert.equal(await put(chef.cookie, chefId), '400 own_account_password', 'not for the own account');
      assert.equal(
        await put(chef.cookie, 2_000_000_000),
        '404 user_not_found',
        'an unknown one is not a silent success',
      );
      const opfer = await anmelden('pw_opfer', 'perLinkGesetzt12');
      assert.match(await put(opfer.cookie, chefId), /^403 /, 'only for admins');
      assert.ok(
        await _req('src/account/passwordHash.js').passwordFits(
          'nochNeuer1234',
          (await db.get('SELECT password_hash FROM users WHERE id = $1', [chefId])).password_hash,
        ),
      );
    });
  } finally {
    srv.close();
    for (const name of ['pw_chef', 'pw_opfer']) {
      await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {});
    }
    await db.pool.end();
  }
});
