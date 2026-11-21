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

const { warte } = require('./helpers/time');

const LANG = 3_600_000;

function testApp(maxMs, verwalter = {}) {
  const app = express();
  app.use(session({ secret: 'test-geheimnis', resave: false, saveUninitialized: false }));
  app.use(
    sessionMaxDuration({
      maxMs,
      adminMaxMs: verwalter.maxMs ?? maxMs,
      adminIdleMs: verwalter.idleMs ?? LANG,
    }),
  );
  app.post('/anmelden', async (req, res) => {
    const admin = req.query.verwalter === '1';
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
  const FRIST = 3_000;
  const { srv, base } = testApp(FRIST);
  t.after(() => new Promise(r => srv.close(r)));
  const r = await fetch(base + '/anmelden', { method: 'POST' });
  const anmeldung = await r.json(); // the session only stands in the store after the last byte
  const keks = r.headers.get('set-cookie').split(';')[0];
  const wer = async () => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).userId;

  await t.test('login sets the timestamp', async () => {
    const { am } = anmeldung;
    assert.ok(typeof am === 'number' && Math.abs(Date.now() - am) < 5_000);
  });

  await t.test('despite activity the session ends after the maximum duration', async () => {
    const bis = ms => warte(Math.max(0, anmeldung.am + ms - Date.now()));
    assert.equal(await wer(), 7);
    await bis(FRIST / 3);
    assert.equal(await wer(), 7, 'innerhalb der Frist gilt sie');
    await bis(FRIST + 200);
    assert.equal(await wer(), null, 'nach der Frist ist niemand mehr angemeldet');
    assert.equal(await wer(), null, 'und die Sitzung ist gelöscht, nicht nur übersprungen');
  });
});

/** Log in and return a fetcher for „who is logged in“. */
async function anmelden(base, verwalter) {
  const r = await fetch(`${base}/anmelden${verwalter ? '?verwalter=1' : ''}`, { method: 'POST' });
  const { am } = await r.json();
  const keks = r.headers.get('set-cookie').split(';')[0];
  return { am, wer: async () => (await (await fetch(base + '/wer', { headers: { cookie: keks } })).json()).userId };
}

test('administrator sessions have shorter periods', async t => {
  await t.test('an administrator session ends after a short idle time, but not while it works', async () => {
    const LEER = 3_000;
    const { srv, base } = testApp(LANG, { idleMs: LEER });
    t.after(() => new Promise(r => srv.close(r)));
    const chef = await anmelden(base, true);
    const nutzer = await anmelden(base, false);
    // Work for longer than the idle time: every request pushes the period.
    const bis = Date.now() + LEER * 1.5;
    while (Date.now() < bis) {
      assert.equal(await chef.wer(), 8, 'trotz Anfragen abgemeldet');
      await warte(400);
    }
    await warte(LEER + 800);
    assert.equal(await chef.wer(), null, 'nach dem Leerlauf noch angemeldet');
    assert.equal(await nutzer.wer(), 7, 'die allgemeine Frist gilt für andere weiter');
  });

  await t.test('… and after its shorter maximum duration', async () => {
    const MAX = 2_000;
    const { srv, base } = testApp(LANG, { maxMs: MAX });
    t.after(() => new Promise(r => srv.close(r)));
    const chef = await anmelden(base, true);
    const nutzer = await anmelden(base, false);
    assert.equal(await chef.wer(), 8);
    await warte(Math.max(0, chef.am + MAX + 300 - Date.now()));
    assert.equal(await chef.wer(), null);
    assert.equal(await nutzer.wer(), 7);
  });

  await t.test('administrators never longer than all others', () => {
    const { sitzungsfristen } = _req('src/account/sessionDeadline.js');
    const f = sitzungsfristen({
      sitzungHoechstStd: 2,
      sitzungLeerlaufMin: 10,
      sitzungVerwalterHoechstStd: 12,
      sitzungVerwalterLeerlaufMin: 30,
    });
    assert.deepEqual(f, {
      maxMs: 2 * 3_600_000,
      adminMaxMs: 2 * 3_600_000,
      adminIdleMs: 10 * 60_000,
    });
    const vorgabe = sitzungsfristen(_req('src/infra/config.js').ladeKonfig({}));
    assert.equal(vorgabe.adminIdleMs, 30 * 60_000, 'Vorgabe 30 Minuten');
    assert.equal(vorgabe.adminMaxMs, 12 * 3_600_000, 'Vorgabe 12 Stunden');
  });
});
