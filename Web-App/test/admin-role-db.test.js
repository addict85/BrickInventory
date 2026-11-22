/**
 * Revoke admin rights — on BOTH paths, with booleans as text.
 *
 * Counter-check (performed): strictBool() in one of the two endpoints replaced again
 * by `is_admin ? 1 : 0` → the corresponding substep turns red.
 * The target is an administrator: since round 29 the revocation is announced (24 h), so
 * the announcement is checked instead of the column.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
// Read the address from server.ts — see einhaengung() in helpers/sources.js.
const AUTH = require('./helpers/sources').mounting('auth');
const { routerServer } = require('./helpers/server');
const db = testData();

test('admin rights can also be revoked with "false" as text', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  const ADMIN = 'rollen-admin-test',
    ZIEL = 'rollen-ziel-test';
  await db.run(`DELETE FROM users WHERE username IN ($1, $2)`, [ADMIN, ZIEL]);
  const bcrypt = require(require('node:path').join(__dirname, '..', 'node_modules', 'bcryptjs'));
  const ADMIN_PW = 'verwalterPasswort1';
  await db.run(
    `INSERT INTO users (username, password_hash, is_admin, is_active)
                VALUES ($1,$3,true,true), ($2,'x',true,true)`,
    [ADMIN, ZIEL, await bcrypt.hash(ADMIN_PW, 4)],
  );
  const adminId = (await db.get(`SELECT id FROM users WHERE username=$1`, [ADMIN])).id;
  const targetId = (await db.get(`SELECT id FROM users WHERE username=$1`, [ZIEL])).id;

  const { base, srv } = routerServer(_req, {
    sitzung: { userId: adminId, username: ADMIN, isAdmin: true },
    apiAccount: { user_id: adminId, is_admin: 1 },
    routen: { [AUTH]: 'routes/auth.js', '/api/v2': 'routes/api/index.js' },
    t,
  });

  const setTargetAdmin = async () => {
    await db.run(`UPDATE users SET is_admin=true WHERE id=$1`, [targetId]);
    await db.run(`DELETE FROM admin_takeovers WHERE target_id=$1`, [targetId]);
  };
  /** 0 as soon as the revocation is announced (or carried out). */
  const adminFlag = async () => {
    const announced = await db.get(`SELECT 1 FROM admin_takeovers WHERE target_id=$1 AND type='revoke_role'`, [
      targetId,
    ]);
    const admin = (await db.get(`SELECT is_admin FROM users WHERE id=$1`, [targetId])).is_admin;
    return admin && !announced ? 1 : 0;
  };

  const revoke = async (url, methode, wert) => {
    await setTargetAdmin();
    const r = await fetch(url, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_admin: wert, admin_password: ADMIN_PW }),
    });
    return { status: r.status, adminAfterwards: await adminFlag() };
  };

  const WEB = `${base}${AUTH}/users/${targetId}/admin`;

  try {
    {
      const name = 'Webapp',
        url = WEB;
      // The actual finding: "false" as a string MUST revoke.
      let e = await revoke(url, 'PUT', 'false');
      assert.equal(e.status, 200, `${name}: "false" sollte angenommen werden`);
      assert.equal(e.adminAfterwards, 0, `${name}: "false" as text must REVOKE the rights`);

      e = await revoke(url, 'PUT', '0');
      assert.equal(e.adminAfterwards, 0, `${name}: "0" as text must revoke the rights`);

      // Real booleans as before.
      e = await revoke(url, 'PUT', false);
      assert.equal(e.adminAfterwards, 0, `${name}: false entzieht`);

      e = await revoke(url, 'PUT', true);
      assert.equal(e.adminAfterwards, 1, `${name}: true vergibt`);

      // Unreadable input is rejected instead of silently doing the opposite.
      e = await revoke(url, 'PUT', 'vielleicht');
      assert.equal(e.status, 400, `${name}: an unreadable value must give 400`);
      assert.equal(e.adminAfterwards, 1, `${name}: on 400 nothing may have changed`);
    }

    // The self-protection must also apply with "false" as text. Previously it was
    // on the v1 route; the rule itself is unchanged and lives in
    // routes/auth.ts.
    const r = await fetch(`${base}${AUTH}/users/${adminId}/admin`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_admin: 'false', admin_password: ADMIN_PW }),
    });
    assert.equal(r.status, 400, 'the own admin role must not be removed, not even with "false"');
    assert.equal((await db.get(`SELECT is_admin FROM users WHERE id=$1`, [adminId])).is_admin, true);
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1, $2)`, [ADMIN, ZIEL]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
