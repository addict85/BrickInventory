/**
 * Revoking rights and deleting accounts must reach the open session.
 *
 * Counter-checks (measured on 28.10.):
 *   A  (26.11.2026) a password check back into PUT /users/:id/admin (the
 *      request carries no password, the login is enough) → red: “revocation failed”
 *   B  protokolliere() before deleting removed → red: log without
 *      „konto_geloescht"
 *
 * The target is an admin: since round 29 revocation and deletion are announced and
 * take effect in the cleanup run (src/account/adminActions.ts); the test executes it.
 *
 * Prerequisite: test DB (contents are touched!) via TEST_DATABASE_URL.
 * Without DB: skip. Run: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, mounting, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const AUTH = mounting('auth');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

const CHEF = 'rechte_chef',
  TARGET = 'rechte_ziel',
  PASS = 'richtigesPasswort1';

test("a change of rights and a deletion end the target's session", { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username IN ($1,$2)', [CHEF, TARGET]);
  const hash = await bcrypt.hash(PASS, 4);
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
    [CHEF, hash],
  );
  await db.run(
    'INSERT INTO users (username,password_hash,is_admin,is_active,email_verified) VALUES ($1,$2,true,true,true)',
    [TARGET, hash],
  );
  const idTarget = (await db.get('SELECT id FROM users WHERE username=$1', [TARGET])).id;

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

  const callFn = async (route, opt = {}) => {
    const r = await fetch(basis + route, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
      ...(opt.body ? { body: JSON.stringify(opt.body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
  };
  const signIn = async name => {
    const a = await callFn(AUTH + '/login', {
      method: 'POST',
      body: { username: name, password: PASS, without_token: true },
    });
    assert.equal(a.status, 200, `login of ${name} failed: ${JSON.stringify(a.body)}`);
    assert.ok(a.cookie, 'Without Set-Cookie there is no session');
    return a.cookie.split(';')[0];
  };
  // Counted via the content, not via the total number of rows: the
  // store also holds sessions of other tests.
  const sessions = async uid =>
    Number(
      (await db.get("SELECT COUNT(*)::int AS n FROM user_sessions WHERE sess::jsonb->>'userId' = $1", [String(uid)])).n,
    );

  /** Make the announcement due and run the cleanup run. */
  const due = async () => {
    await db.run(`UPDATE admin_takeovers SET effective_at = NOW() - INTERVAL '1 minute' WHERE target_id = $1`, [
      idTarget,
    ]);
    return _req('src/account/adminActions.js').runDueTakeoversFrom();
  };

  try {
    const chefCookie = await signIn(CHEF);

    // ── 1. Rechteentzug ─────────────────────────────────────────────────────
    await signIn(TARGET);
    assert.equal(await sessions(idTarget), 1, 'precondition: the target has exactly one open session');

    const revocation = await callFn(AUTH + `/users/${idTarget}/admin`, {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: false },
    });
    assert.equal(revocation.status, 200, `revocation failed: ${JSON.stringify(revocation.body)}`);
    assert.ok(revocation.body.effective_at, 'For an admin the revocation is announced');
    assert.equal(await sessions(idTarget), 1, 'Before the deadline the session stays');
    assert.equal(await due(), 1);
    assert.equal(
      await sessions(idTarget),
      0,
      "The target's session lives on — then it stays admin in its open window, " +
        'because session.isAdmin is never updated',
    );

    // ── 2. No kick-out without a real change ───────────────────────────────
    //
    // Otherwise an admin who merely confirms an existing state would
    // end a foreign session without reason — and lock himself out
    // if he does it on his own account.
    await signIn(TARGET);
    assert.equal(await sessions(idTarget), 1, 'precondition for the non-change');
    const again = await callFn(AUTH + `/users/${idTarget}/admin`, {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: false, admin_password: PASS },
    });
    assert.equal(
      again.status,
      200,
      'Setting the same value again must succeed — the existence check no longer ' +
        'depends on r.changes, which can be 0 for an UPDATE with the same value',
    );
    assert.equal(await sessions(idTarget), 1, 'Without a real change no session may end');

    // ── 2b. An unknown account ───────────────────────────────────────────
    //
    // Since the rebuild the existence check hangs on the preceding SELECT instead of
    // on r.changes. Without this assertion its removal would have gone
    // unnoticed — the route would then answer with 200 to an identifier that does
    // not exist.
    const unknownOne = await callFn(AUTH + '/users/99999999/admin', {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: true, admin_password: PASS },
    });
    assert.equal(unknownOne.status, 404, 'A non-existing account must yield 404, not 200');

    // ── 3. And the opposite direction: GRANTING rights ───────────────────────────
    const assignment = await callFn(AUTH + `/users/${idTarget}/admin`, {
      method: 'PUT',
      headers: { cookie: chefCookie },
      body: { is_admin: true, admin_password: PASS },
    });
    assert.equal(assignment.status, 200);
    assert.equal(
      await sessions(idTarget),
      0,
      'On granting, too, the session must end — a foreign session cannot ' +
        'be rewritten, and otherwise the target would never see its new rights',
    );

    // ── 4. Kontoloeschung ───────────────────────────────────────────────────
    await signIn(TARGET);
    assert.equal(await sessions(idTarget), 1, 'precondition for the deletion');
    const route = await callFn(AUTH + `/users/${idTarget}`, {
      method: 'DELETE',
      headers: { cookie: chefCookie },
    });
    assert.equal(route.status, 200, `deleting failed: ${JSON.stringify(route.body)}`);
    assert.ok(route.body.effective_at, 'For an admin the deletion is announced');
    assert.equal(await due(), 1);
    assert.equal(
      await sessions(idTarget),
      0,
      'The deleted account is still logged in — user_sessions hangs on no ' +
        'foreign key, the row must be removed explicitly',
    );
    assert.equal(
      await db.get('SELECT id FROM users WHERE id=$1', [idTarget]),
      undefined,
      'precondition: the account is really deleted',
    );

    // ── 5. Every admin action stands in the log — also the deletion ──────
    const log = await db.all(`SELECT action, target_name FROM admin_log WHERE target_id = $1 ORDER BY id`, [idTarget]);
    assert.deepEqual(
      log.map(p => p.action),
      ['takeover_announced', 'admin_revoked', 'admin_appointed', 'takeover_announced', 'account_deleted'],
    );
    assert.ok(
      log.every(p => p.target_name === TARGET),
      'The name must stay readable even after deleting',
    );
  } finally {
    await new Promise(r => srv.close(r));
    await db.run('DELETE FROM users WHERE username IN ($1,$2)', [CHEF, TARGET]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
