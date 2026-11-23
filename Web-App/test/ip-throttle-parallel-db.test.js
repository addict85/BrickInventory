/**
 * The per-address throttle (ipThrottle) also withstands concurrent requests.
 *
 * Previously it read the counter and only incremented afterwards: 25 parallel
 * /register all got through, 5 per hour are allowed.
 *
 * ── Counter-check (performed, finding MEASURED) ─────────────────────────────
 *
 *   ipThrottle again with _read + _bump (old version), run four times
 *   → 1 red every time (6 to 9 of 25 let through, in round 1 or 2);
 *     2 red four times (6 to 10 responses with 200). A single burst did not
 *     always hit the race, hence case 1 runs five rounds.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Links in mails only exist with a fixed address (routes/auth.ts, getBaseUrl).
process.env.APP_BASE_URL = 'http://localhost';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const AUTH = require('./helpers/sources').mounting('auth');
const db = testData();
const ipThrottle = (...a) =>
  _req('src/account/http/login.js').ipThrottle(require('./helpers/sources').testServices().account, ...a);
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test.after(() => db.pool.end().catch(() => {}));

async function dbDa(t) {
  try {
    await db.initSchema();
    return true;
  } catch (e) {
    noDb(t, e);
    return false;
  }
}

function start(t, mount) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {};
    next();
  });
  mount(app);
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  return `http://localhost:${srv.address().port}`;
}

const parallel = (n, f) => Promise.all(Array.from({ length: n }, f));

test('1. 25 concurrent requests: exactly 5 get through, in every round', async t => {
  if (!(await dbDa(t))) return;
  // Several rounds: the old version's race did not occur in every burst.
  for (let round = 1; round <= 5; round++) {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'parallel-probe|%'`);
    let via = 0;
    const base = start(t, app =>
      app.post('/probe', ipThrottle('parallel-probe', 5, 60 * 60 * 1000), (_req, res) => {
        via++;
        res.json({ ok: true });
      }),
    );
    const status = await parallel(25, () => fetch(`${base}/probe`, { method: 'POST' }).then(r => r.status));
    assert.equal(via, 5, `Round ${round}: ${via} of 25 let through, 5 are allowed`);
    assert.equal(status.filter(s => s === 429).length, 20);
  }
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'parallel-probe|%'`);
});

test('2. the same at the real route /forgot-password', async t => {
  if (!(await dbDa(t))) return;
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-password|%'`);
  t.after(() => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-password|%'`));
  const base = start(t, app => app.use(AUTH, require('./helpers/sources').routerFrom(_req, 'routes/auth.js')));
  const status = await parallel(25, () =>
    fetch(`${base}${AUTH}/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'niemand.parallel@example.ch' }),
    }).then(r => r.status),
  );
  assert.equal(status.filter(s => s === 200).length, 5, `Responses: ${status.join(',')}`);
  assert.equal(status.filter(s => s === 429).length, 20);
});
