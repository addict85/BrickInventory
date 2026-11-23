/**
 * A web app session ends after the maximum duration, even if it is used.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  `app.use(sessionMaxDuration())` removed in startup/app.ts → red in
 *      session-app-db.test.js “after the maximum duration nobody is logged in anymore”
 *   B  in sessionMaxDuration `s.destroy(...)` replaced by `next()` → red:
 *      “despite activity the session ends after the maximum duration”
 *   C  `angemeldetAm` not set in establishSession → red: “login
 *      sets the timestamp” (the period would only begin on the next call)
 *   Admins (measured 14.11.2026, each on its own):
 *   D  the idle check for admins deleted in sessionMaxDuration → red:
 *      “an administrator session ends after a short idle time …” (still logged in after the idle time)
 *   E  the carrying along of lastlyAt deleted → red: the same check (“while it
 *      works”: logged out despite requests)
 *   F  adminMaxMs replaced by maxMs → red: “… and after its shorter maximum duration”
 *   G  the Math.min for the idle time deleted in sitzungsfristen() → red: “administrators never longer …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const { sessionMaxDuration } = _req('src/account/sessionDeadline.js');
const establishSession = (...a) =>
  _req('src/account/http/login.js').establishSession(require('./helpers/sources').testServices().account, ...a);

const { sleep } = require('./helpers/time');

const LANG = 3_600_000;

function testApp(maxMs, adminUser = {}) {
  const app = express();
  app.use(session({ secret: 'test-geheimnis', resave: false, saveUninitialized: false }));
  app.use(
    sessionMaxDuration({
      maxMs,
      adminMaxMs: adminUser.maxMs ?? maxMs,
      adminIdleMs: adminUser.idleMs ?? LANG,
    }),
  );
  app.post('/anmelden', async (req, res) => {
    const admin = req.query.admin === '1';
    await establishSession(req, { userId: admin ? 8 : 7, username: 'x', isAdmin: admin });
    res.json({ am: req.session.angemeldetAm });
  });
  app.get('/wer', (req, res) => res.json({ userId: req.session?.userId ?? null }));
  const srv = app.listen(0);
  return { srv, base: `http://localhost:${srv.address().port}` };
}

test('maximum duration of the web app session', async t => {
  // Generous period and waits from the measured login time: under
  // load a call takes hundreds of milliseconds, fixed steps then toppled.
  const DEADLINE = 3_000;
  const { srv, base } = testApp(DEADLINE);
  t.after(() => new Promise(r => srv.close(r)));
  const r = await fetch(base + '/anmelden', { method: 'POST' });
  const login = await r.json(); // the session only stands in the store after the last byte
  const keks = r.headers.get('set-cookie').split(';')[0];
  const who = async () => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).userId;

  await t.test('login sets the timestamp', async () => {
    const { am } = login;
    assert.ok(typeof am === 'number' && Math.abs(Date.now() - am) < 5_000);
  });

  await t.test('despite activity the session ends after the maximum duration', async () => {
    const until = ms => sleep(Math.max(0, login.am + ms - Date.now()));
    assert.equal(await who(), 7);
    await until(DEADLINE / 3);
    assert.equal(await who(), 7, 'within the period it is valid');
    await until(DEADLINE + 200);
    assert.equal(await who(), null, 'after the period nobody is logged in any more');
    assert.equal(await who(), null, 'and the session is deleted, not just skipped');
  });
});

/** Log in and return a fetcher for „who is logged in“. */
async function signIn(base, adminUser) {
  const r = await fetch(`${base}/anmelden${adminUser ? '?admin=1' : ''}`, { method: 'POST' });
  const { am } = await r.json();
  const keks = r.headers.get('set-cookie').split(';')[0];
  return { am, who: async () => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).userId };
}

test('administrator sessions have shorter periods', async t => {
  await t.test('an administrator session ends after a short idle time, but not while it works', async () => {
    const EMPTY = 3_000;
    const { srv, base } = testApp(LANG, { idleMs: EMPTY });
    t.after(() => new Promise(r => srv.close(r)));
    const chef = await signIn(base, true);
    const user = await signIn(base, false);
    // Work for longer than the idle time: every request pushes the period.
    const until = Date.now() + EMPTY * 1.5;
    while (Date.now() < until) {
      assert.equal(await chef.who(), 8, 'logged out despite requests');
      await sleep(400);
    }
    await sleep(EMPTY + 800);
    assert.equal(await chef.who(), null, 'still logged in after the idle time');
    assert.equal(await user.who(), 7, 'the general period still applies for others');
  });

  await t.test('… and after its shorter maximum duration', async () => {
    const MAX = 2_000;
    const { srv, base } = testApp(LANG, { maxMs: MAX });
    t.after(() => new Promise(r => srv.close(r)));
    const chef = await signIn(base, true);
    const user = await signIn(base, false);
    assert.equal(await chef.who(), 8);
    await sleep(Math.max(0, chef.am + MAX + 300 - Date.now()));
    assert.equal(await chef.who(), null);
    assert.equal(await user.who(), 7);
  });

  await t.test('administrators never longer than all others', () => {
    const { sessionDeadlines: sessionTimeouts } = _req('src/account/sessionDeadline.js');
    const f = sessionTimeouts({
      sessionMaxHours: 2,
      sessionIdleMin: 10,
      sessionAdminMaxHours: 12,
      sessionAdminIdleMin: 30,
    });
    assert.deepEqual(f, {
      maxMs: 2 * 3_600_000,
      adminMaxMs: 2 * 3_600_000,
      adminIdleMs: 10 * 60_000,
    });
    const preset = sessionTimeouts(_req('src/infra/config.js').loadConfig({}));
    assert.equal(preset.adminIdleMs, 30 * 60_000, 'default 30 minutes');
    assert.equal(preset.adminMaxMs, 12 * 3_600_000, 'default 12 hours');
  });
});
