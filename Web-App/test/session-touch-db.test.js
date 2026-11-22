/**
 * The expiry time of the session is written throttled.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const { buildAndRequire, ohneKommentare, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const { touchThrottle } = _req('src/account/sessionTouch.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const session = require(path.join(ROOT, 'node_modules', 'express-session'));
const pgSession = require(path.join(ROOT, 'node_modules', 'connect-pg-simple'))(session);

const gesehen = [];
let count = false;
const altQuery = db.pool.query.bind(db.pool);
db.pool.query = (text, ...rest) => {
  if (count) gesehen.push(String(typeof text === 'string' ? text : text?.text || '').replace(/\s+/g, ' '));
  return altQuery(text, ...rest);
};
const howOften = muster => gesehen.filter(q => muster.test(q)).length;
const LESEN = /SELECT sess FROM "?user_sessions"?/;
const WRITE = /UPDATE "?user_sessions"? SET expire/;

/** A server with a real session store; `frist` controls the throttling. */
async function startServer(frist) {
  const speicher = new pgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: false });
  if (frist !== null) touchThrottle(speicher, frist);
  const app = express();
  app.use(
    session({
      store: speicher,
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'strict' },
    }),
  );
  app.get('/anmelden', (req, res) => {
    req.session.userId = 990601;
    res.json({ ok: true });
  });
  app.get('/bild', (req, res) => {
    res.json({ uid: req.session?.userId ?? null });
  });
  const srv = app.listen(0);
  return { srv, base: `http://localhost:${srv.address().port}` };
}

async function anmelden(base) {
  const r = await fetch(base + '/anmelden');
  await r.text(); // the session only stands in the store after the last byte
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

test('session: always read, written only every few minutes', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  const N = 20;
  const server = [];
  try {
    // ── 1. With throttling: N reads, ONE write ──────────────
    const a = await startServer(5 * 60 * 1000);
    server.push(a.srv);
    const keksA = await anmelden(a.base);
    gesehen.length = 0;
    count = true;
    let letzte = null;
    for (let i = 0; i < N; i++) letzte = await (await fetch(a.base + '/bild', { headers: { cookie: keksA } })).json();
    count = false;

    assert.equal(howOften(LESEN), N, `gelesen wird bei jeder Anfrage — erwartet ${N}, gezählt ${howOften(LESEN)}`);
    // EXACTLY one, and both deviations are errors: more means the
    // throttling does not apply; ZERO means it throttles too much and the
    // expiry time is never carried along.
    assert.equal(
      howOften(WRITE),
      1,
      `${howOften(WRITE)} Schreibvorgänge bei ${N} Anfragen — erwartet genau 1 ` +
        `(mehr: die Drosselung greift nicht; keiner: sie drosselt zu viel)`,
    );

    // ── 2. The session lives on ─────────────────────────────────────────
    // Without this assertion „not writing at all any more" would be the best grade.
    assert.equal(letzte.uid, 990601, 'die Sitzung muss über alle Anfragen hinweg gültig bleiben');

    // ── 3. And the expiry time really stands in the database ──────────────
    const sid = decodeURIComponent(keksA.split('=')[1]).slice(2).split('.')[0];
    const row = await db.get('SELECT expire FROM user_sessions WHERE sid = $1', [sid]);
    assert.ok(row?.expire, 'die Sitzungszeile muss eine Ablaufzeit tragen');
    assert.ok(
      new Date(row.expire).getTime() > Date.now(),
      'die Ablaufzeit muss in der Zukunft liegen — sonst ist die Sitzung sofort tot',
    );

    // ── COUNTER-CHECK: without a period every request writes ───────────────────────
    // The same route with period 0. If the number stayed at 1 here too, the
    // saving above would come from something other than the throttling.
    const b = await startServer(0);
    server.push(b.srv);
    const keksB = await anmelden(b.base);
    gesehen.length = 0;
    count = true;
    for (let i = 0; i < N; i++) await fetch(b.base + '/bild', { headers: { cookie: keksB } });
    count = false;
    assert.equal(
      howOften(WRITE),
      N,
      `Gegenprobe: ohne Frist müssten es ${N} Schreibvorgänge sein, gezählt ${howOften(WRITE)}`,
    );

    // ── 4. And startup/app.ts uses the throttling at all ──────────────────
    // A helper that nobody calls is the most expensive way of doing nothing —
    // and the assertions above would stay green, because they build their store
    // themselves.
    const source = ohneKommentare(fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8'));
    assert.match(
      source,
      /touchThrottle\(sessionStorage[,)]/,
      'startup/app.ts drosselt seinen Sitzungsspeicher nicht — dann zahlt die Webapp weiter zwei Abfragen je Anfrage',
    );
  } finally {
    db.pool.query = altQuery;
    for (const s of server) await new Promise(r => s.close(r));
    await db.run("DELETE FROM user_sessions WHERE sess::text LIKE '%990601%'").catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
