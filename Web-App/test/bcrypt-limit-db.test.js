/**
 * At most as many concurrent bcrypt runs as the barrier allows
 * (src/account/bcryptLimit.ts); behind it a bounded queue with a
 * deadline, everything beyond gets 503 server_busy at login. (A signed-in
 * session checks no password any more, docs/SICHERHEIT.md.)
 *
 * Counter-checks (measured on 03.11.2026, each alone):
 *   A  in newLimit() the queue limit removed → red: both
 *      tests (the surplus one waited instead of being rejected)
 *   B  checkCredentials() without bcryptGate.run() → red: “with a full
 *      barrier …” (the login got through)
 *
 * Whoever last logged in from this address with this name waits
 * at the front and is not rejected because of the queue length (round 12, H3).
 * Counter-checks (measured 04.11.2026):
 *   D  in newLimit() `priority` ignored → red: “priority …” and “with a
 *      full barrier …” (the known login is not in the queue)
 *   E  checkCredentials() without knownLogin() (always false) → red:
 *      “with a full barrier …” (the same)
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { newLimit, bcryptGate, BcryptOverload } = _req('src/account/bcryptLimit.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('the limit lets n run, m wait and rejects the rest', async () => {
  const s = newLimit(2, 1, 200);
  const open = [];
  const blocked = () => new Promise(r => open.push(r));
  const a = s.run(blocked),
    b = s.run(blocked);
  const c = s.run(async () => 'c');
  await assert.rejects(
    s.run(async () => 'd'),
    BcryptOverload,
  );
  assert.deepEqual(s.state(), { running: 2, waiting: 1 });
  open.shift()('a');
  assert.equal(await a, 'a');
  assert.equal(await c, 'c', 'the waiting one gets the freed slot');
  open.shift()('b');
  await b;
  assert.deepEqual(s.state(), { running: 0, waiting: 0 });
  // Deadline: whoever waits too long is rejected and frees their place in the queue.
  const x = s.run(blocked),
    y = s.run(blocked);
  await assert.rejects(
    s.run(async () => 'z'),
    BcryptOverload,
  );
  assert.deepEqual(s.state(), { running: 2, waiting: 0 });
  for (const r of open.splice(0)) r();
  await x;
  await y;
});

test('priority: to the front of the queue, even if it is full', async () => {
  const s = newLimit(1, 1, 1000);
  const open = [],
    rowList = [];
  const a = s.run(() => new Promise(r => open.push(r)));
  const b = s.run(async () => {
    rowList.push('b');
  });
  const v = s.run(async () => {
    rowList.push('v');
  }, true);
  await assert.rejects(
    s.run(async () => 'x'),
    BcryptOverload,
  );
  assert.deepEqual(s.state(), { running: 1, waiting: 2 });
  open.shift()();
  await Promise.all([a, b, v]);
  assert.deepEqual(rowList, ['v', 'b']);
});

test('with a full limit, the login answers 503', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const NAME = `schranke_${process.pid}`,
    PASS = 'Schranken-Passwort-1';
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, $2, true, true) RETURNING id`,
      [NAME, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));

  const session = {};
  const { base } = testServer(_req, { session, t });
  const post = async (route, body) => {
    const r = await fetch(`${base}/api/v2/auth${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  // Occupy all slots and the whole queue.
  const cores = Math.max(2, os.availableParallelism());
  const open = [];
  const occupied = [];
  for (let i = 0; i < cores * 9; i++) occupied.push(bcryptGate.run(() => new Promise(r => open.push(r))));
  assert.deepEqual(bcryptGate.state(), { running: cores, waiting: cores * 8 });
  try {
    const login = await post('/login', { username: NAME, password: PASS });
    assert.deepEqual([login.status, login.body.code], [503, 'server_busy'], JSON.stringify(login.body));
  } finally {
    while (open.length || bcryptGate.state().running) {
      for (const r of open.splice(0)) r();
      await new Promise(r => setImmediate(r));
    }
    await Promise.all(occupied);
  }
  const afterwards = await post('/login', { username: NAME, password: PASS });
  assert.equal(afterwards.status, 200, JSON.stringify(afterwards.body));

  // Now the login from here is known: it waits at the front, a foreign one is rejected.
  for (let i = 0; i < cores * 9; i++) occupied.push(bcryptGate.run(() => new Promise(r => open.push(r))));
  try {
    delete session.userId;
    const known = post('/login', { username: NAME, password: PASS });
    const fremd = await post('/login', { username: `${NAME}_x`, password: PASS });
    assert.deepEqual([fremd.status, fremd.body.code], [503, 'server_busy']);
    for (let i = 0; i < 200 && bcryptGate.state().waiting <= cores * 8; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(bcryptGate.state().waiting, cores * 8 + 1, 'the known sign-in does not wait');
    open.shift()();
    const r = await known;
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } finally {
    while (open.length || bcryptGate.state().running) {
      for (const r of open.splice(0)) r();
      await new Promise(r => setImmediate(r));
    }
    await Promise.all(occupied);
  }
});
