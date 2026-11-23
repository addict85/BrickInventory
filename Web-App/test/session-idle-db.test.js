/**
 * A web app session without activity expires — one with activity does not.
 *
 * ── Counter-checks (carried out, results copied) ────────────────────
 *
 * Each hits EXACTLY ONE case — that is the point: if a variant
 * knocked over several cases, we would not know which case measures what.
 *
 *   A  `ttl` removed from the store (the state BEFORE this change)
 *      → only case 1 red. The session lives on, because then the
 *        day of connect-pg-simple applies again.
 *   B  throttling 10000 ms with a 5 s period — i.e. longer than the period
 *      (measured again on 30.10.2026 with today's numbers, likewise A)
 *      → only case 2 red. The expiry is not carried along, the ACTIVE
 *        session dies in the middle of operation.
 *   C  `ttl` removed from startup/app.ts → red in session-app-db.test.js; the
 *      cases here build their store themselves and notice nothing of it.
 *
 * Prerequisite: test DB (contents are touched!) via TEST_DATABASE_URL.
 * Without DB: skip. Run: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const { touchThrottle, touchMs } = _req('src/account/sessionTouch.js');
const { sessionIdleMs, sessionIdleSec, IDLE_DEFAULT_MIN } = _req('src/account/sessionDeadline.js');
// The default as handed-in configuration, as buildServices hands it in.
const DEFAULT = { sessionIdleMin: IDLE_DEFAULT_MIN };
const SESSION_IDLE_MS = sessionIdleMs(DEFAULT);
const SESSION_IDLE_SEC = sessionIdleSec(DEFAULT);
const TOUCH_MS = touchMs(SESSION_IDLE_MS);
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);

/** An own identifier per run, so that the cleanup hits nothing foreign. */
const UID = 990717;

/**
 * A server as in server.ts, only with short periods.
 *
 * @param ttlSec    idle period in seconds (fractions allowed).
 * @param throttleMs period of the throttling; `null` = do not throttle at all.
 */
async function startServer(ttlSec, throttleMs) {
  const storage = new pgSession({
    pool: db.pool,
    tableName: 'user_sessions',
    createTableIfMissing: false,
    ...(ttlSec === null ? {} : { ttl: ttlSec }),
  });
  if (throttleMs !== null) touchThrottle(storage, throttleMs);
  const app = express();
  app.use(
    session({
      store: storage,
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'strict' }, // no maxAge — as in server.ts
    }),
  );
  app.get('/anmelden', (req, res) => {
    req.session.userId = UID;
    res.json({ ok: true });
  });
  app.get('/wer', (req, res) => {
    res.json({ uid: req.session?.userId ?? null });
  });
  const srv = app.listen(0);
  return { srv, base: `http://localhost:${srv.address().port}` };
}

const signIn = async base => {
  const r = await fetch(base + '/anmelden');
  await r.text(); // the session only stands in the store after the last byte
  return (r.headers.get('set-cookie') || '').split(';')[0];
};
const who = async (base, keks) => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).uid;
const { sleep } = require('./helpers/time');

/**
 * Cleanup — and that in `after`, not at the end of a case.
 */
after(async () => {
  await db.run('DELETE FROM user_sessions WHERE sess::text LIKE $1', [`%${UID}%`]).catch(() => {});
  await db.pool.end().catch(() => {});
});

test('without activity the session expires', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  // 5 s instead of 2 s: under load (parallel full run) more than 2 s already lay between login
  // and the first read, and the precondition toppled.
  const { srv, base } = await startServer(5, null);
  try {
    const keks = await signIn(base);
    assert.equal(
      await who(base, keks),
      UID,
      'right after logging in the session must be valid — otherwise the rest measures nothing',
    );

    await sleep(7000); // 5 s period, 2 s reserve — see header
    assert.equal(
      await who(base, keks),
      null,
      'after the idle period the session must no longer be valid — ' +
        'if the session store lacks the `ttl`, the day of connect-pg-simple applies again',
    );
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('with activity the session stays', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  // The same ratio as in production: the throttling is one fifth of the
  // period, not longer. With a throttling longer than the period
  // this case turns red — measured, see header.
  const { srv, base } = await startServer(5, 1000);
  try {
    const keks = await signIn(base);
    // Work BEYOND the period: 20 requests at 400 ms = 8 s with a 5 s
    // period. Without carrying it along the session would be dead after about request 13.
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      assert.equal(
        await who(base, keks),
        UID,
        `the active session died at request ${i + 1} of 20 — ` +
          'the expiry is not extended (does the touch throttle longer than the period?)',
      );
    }
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('the throttling is shorter than the period', () => {
  // The core of the coupling, without a server: if it were longer, the WORKING
  // user would be thrown out instead of the idle one.
  assert.ok(
    TOUCH_MS * 2 <= SESSION_IDLE_MS,
    `The throttle (${TOUCH_MS} ms) is not clearly shorter than the ` +
      `idle period (${SESSION_IDLE_MS} ms) — then the expiry is not ` +
      'extended in time and an active session dies in the middle of use.',
  );

  // And the default is the one that stands in the README.
  assert.equal(SESSION_IDLE_MS, IDLE_DEFAULT_MIN * 60_000);
  assert.equal(SESSION_IDLE_SEC, IDLE_DEFAULT_MIN * 60);
  // At four hours the throttling stays at the previous five minutes:
  // a quarter of it would be an hour, the minimum wins.
  assert.equal(
    TOUCH_MS,
    5 * 60 * 1000,
    'With the default of four hours it should stay five minutes — ' +
      'otherwise the web app writes more than necessary again',
  );
});
