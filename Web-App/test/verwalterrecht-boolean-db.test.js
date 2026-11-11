/**
 * is_admin des Zugangs ist ein boolean, auf jedem Weg: Token mit Scope
 * `voll` true, mit `app` false; requireToken reicht es so an req.apiUser weiter.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  in pruefeToken() wieder `… ? 1 : 0` → rot: beide Teile
 *   B  in requireToken `is_admin: user.is_admin ? 1 : 0` → rot: „requireToken
 *      reicht ein boolean weiter“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

test('Verwalterrecht als boolean', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const A = _req('src/konto/auth.js');
  const name = `vb_${process.pid}`;
  const { id } = await db.get(
    `INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', true) RETURNING id`,
    [name],
  );
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [id]);
    await db.pool.end().catch(() => {});
  });
  const voll = await A.createToken(id, 'voll', false, null, { scope: 'voll' });
  const app = await A.createToken(id, 'app', false, null, { scope: 'app' });

  await t.test('ein Token mit Scope voll trägt true, mit app false', async () => {
    assert.equal((await A.pruefeToken(voll)).nutzer?.is_admin, true);
    assert.equal((await A.pruefeToken(app)).nutzer?.is_admin, false);
  });

  await t.test('requireToken reicht ein boolean weiter', async () => {
    const { requireToken } = _req('routes/api_v1/middleware.js');
    for (const [token, soll] of [
      [voll, true],
      [app, false],
    ]) {
      const req = { method: 'GET', path: '/x', headers: { authorization: `Bearer ${token}` }, ip: '127.0.0.1' };
      await new Promise((weiter, fehler) => {
        const res = { status: () => res, json: r => fehler(new Error(JSON.stringify(r))), setHeader: () => {} };
        requireToken(req, res, weiter);
      });
      assert.equal(req.apiUser.is_admin, soll);
    }
  });
});
