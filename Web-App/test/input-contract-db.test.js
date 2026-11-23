/**
 * Inputs are checked against the contract in production before the route runs
 * (checkInput in src/http/contractRouter.ts, set before every endpoint by
 * vertragsRouter()). A list instead of a text previously got past
 * USERNAME_RE into the SQL, and free text was unlimited.
 *
 * Counter-checks (measured on 01.11.2026):
 *   A  in vertragsRouter() inserting checkInput removed → red:
 *      “a list instead of a name is 400”, “free text is limited” and
 *      “a repeated query value is 400”
 *   B  the query check removed in checkInput → red: “a
 *      repeated query value is 400”
 *   C  in checkInput the validators' own error ignored (always
 *      input_invalid) → red: “the validators from validate.ts answer like the
 *      route”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();

test('inputs against the contract', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `eingabe_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const PASS = 'Eingabe-Passwort-1';
  const hash = await require(require('node:path').join(__dirname, '..', 'node_modules', 'bcryptjs')).hash(PASS, 4);
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, true) RETURNING id`, [
      NAME,
      hash,
    ])
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const codes = await adminWithFactor(_req, uid);
  const { base } = testServer(_req, { session: { userId: uid, isAdmin: true }, t });
  const send = async (method, path, body) => {
    const r = await fetch(base + path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, code: j.code ?? null, error: j.error ?? null };
  };

  await t.test('a list instead of a name is 400', async () => {
    const r = await send('POST', '/api/v2/auth/register', {
      username: ['abc'],
      email: 'a@b.ch',
      password: 'Lang-genug-1234',
    });
    assert.deepEqual([r.status, r.code], [400, 'input_invalid']);
    assert.match(r.error, /username/);
    const none = await send('POST', '/api/v2/auth/login', { username: { $ne: 1 }, password: 'x' });
    assert.deepEqual([none.status, none.code], [400, 'input_invalid']);
  });

  await t.test('free text is limited', async () => {
    const r = await send('PUT', '/api/v2/auth/profile', { first_name: 'x'.repeat(101) });
    assert.deepEqual([r.status, r.code], [400, 'input_invalid']);
    const ok = await send('PUT', '/api/v2/auth/profile', {
      first_name: 'Marco',
      last_name: null,
      password_current: PASS,
      code: codes.shift(),
    });
    assert.equal(ok.status, 200, `valid input rejected: ${ok.code}`);
    assert.equal((await db.get('SELECT first_name FROM users WHERE id = $1', [uid])).first_name, 'Marco');
  });

  await t.test('a repeated query value is 400', async () => {
    assert.equal((await send('GET', '/api/v2/auth/profile?x=1')).status, 200);
    const r = await send('GET', '/api/v2/auth/profile?x=1&x=2');
    assert.deepEqual([r.status, r.code], [400, 'input_invalid']);
  });

  await t.test('the validators from validate.ts answer like the route', async () => {
    const r = await send('PUT', `/api/v2/auth/users/${uid}/admin`, { is_admin: 'vielleicht' });
    assert.equal(r.status, 400);
    assert.notEqual(r.code, 'input_invalid');
    assert.match(r.error, /is_admin/);
  });

  await t.test('without login it stays 401, not 400', async () => {
    const { base: open } = testServer(_req, { session: {}, t });
    const r = await fetch(`${open}/api/v2/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: ['x'] }),
    });
    assert.equal(r.status, 401);
  });
});
