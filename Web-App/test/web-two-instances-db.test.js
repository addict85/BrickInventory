/**
 * Two web instances on one database share the request budget and the PDF tickets
 * (api_budget, pdf_tickets, migration 0135). Each instance has its own access, its own
 * services and its own Express app (startup/app.ts), as two processes would; the last case
 * starts the real server twice side by side.
 *
 * Counter-checks (measured 22.11.2026, each alone):
 *   A  checkBudget() counting in a Map per store (= per set of services) instead of the
 *      database → red: “both instances draw on one budget” and “… 429 on the other”
 *   B  the PDF tickets back in a Map in the voucher compartments → red: “a ticket issued on A is
 *      redeemed once on B”
 *   C  the web lock of the previous version restored (server.ts with holdWebLock, its module and
 *      LOCKS.WEB_PROCESS) → red: “two real servers answer at the same time”
 *   D  in claimApiBudget a rejected claim adds its cost → red: “rejected requests do not count”
 *   E  in takeTicket the expiry check `expires_at >= …` replaced by TRUE → red: “after 60 s …”
 *
 * @superuser (ratchet in test/roles-separation-db.test.js): the real server checks the role.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');
const { portOf } = require('./helpers/server');

const ROOT = path.join(__dirname, '..');
const dbModule = require(path.join(ROOT, 'dist', 'db', 'database.js'));

/** An instance as server.ts builds one: own access, own services, own app; a set session. */
function instance(t, uid) {
  const db = dbModule.createDb(dbModule.dbConfigFromEnvironment());
  const clock = _req('src/infra/clock.js').settableClock();
  const dienste = _req('startup/wiring.js').buildServices(db, { clock: clock });
  const app = _req('startup/app.js').buildApp({
    pool: db.systemWebPool,
    config: _req('src/infra/config.js').config(),
    sitzungsGeheimnis: 'zwei-instanzen-geheimnis-lang-genug',
    dienste,
    sessionStorage: (req, _res, next) => {
      req.session = { userId: uid };
      next();
    },
  });
  const srv = app.listen(0);
  t.after(async () => {
    await new Promise(r => srv.close(r));
    await db.pool.end();
  });
  const base = `http://localhost:${portOf(srv)}`;
  return { db, dienste, clock, get: p => fetch(base + p) };
}

test('two web instances on one database', { concurrency: 1, timeout: 180_000 }, async t => {
  const data = await dataOrSkip(t, _req);
  if (!data) return;
  t.after(() => data.pool.end().catch(() => {}));
  const uid = async name =>
    (await data.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name])).id;
  const [eins, zwei] = [await uid('zwei-instanzen-1'), await uid('zwei-instanzen-2')];
  const { BUDGET, JOB_BUDGET, WINDOW_MS, COST, checkBudget } = _req('src/http/apiThrottle.js');
  const a = instance(t, eins),
    b = instance(t, eins);
  const remaining = r => Number(r.headers.get('ratelimit-remaining'));
  const claim = (inst, konto, method, p, now) =>
    q.asAccount(konto, () => checkBudget(inst.dienste.throttle, konto, method, p, now));
  const clear = () => data.run('DELETE FROM api_budget');

  await t.test('both instances draw on one budget', async () => {
    await clear();
    const ra = await a.get('/api/v2/sets');
    const rb = await b.get('/api/v2/sets');
    assert.deepEqual([remaining(ra), remaining(rb)], [BUDGET - 1, BUDGET - 2]);
  });

  await t.test('what one instance used up gives 429 on the other', async () => {
    await clear();
    const now = Date.now();
    assert.equal((await claim(a, eins, 'GET', '/sets', now)).erlaubt, true);
    // The rest of the budget in one claim: BUDGET - 1 units of cost 1 would take 599 queries.
    await q.asAccount(eins, () =>
      a.dienste.throttle.claimApiBudget(eins, {
        cost: BUDGET - 1,
        job: false,
        windowS: WINDOW_MS / 1000,
        budget: BUDGET,
        jobBudget: JOB_BUDGET,
        nowMs: now,
      }),
    );
    const r = await b.get('/api/v2/sets');
    assert.equal(r.status, 429);
    assert.equal((await r.json()).code, 'too_many_requests');
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
  });

  await t.test('an account does not use up the budget of another', async () => {
    await clear();
    const now = 2_000_000_000_000;
    for (let i = 0; i < BUDGET; i++) await claim(a, eins, 'GET', '/sets', now);
    assert.equal((await claim(b, eins, 'GET', '/sets', now)).erlaubt, false);
    assert.equal((await claim(b, zwei, 'GET', '/sets', now)).erlaubt, true);
  });

  await t.test('rejected requests do not count; after the window it starts anew', async () => {
    await clear();
    const now = 2_000_000_000_000;
    for (let i = 0; i < BUDGET; i++) await claim(a, eins, 'GET', '/sets', now);
    let ab;
    for (let i = 0; i < 5; i++) ab = await claim(b, eins, 'GET', '/sets', now + 1000);
    assert.equal(ab.erlaubt, false);
    assert.equal(ab.units, BUDGET, 'the rejection must not push the counter up further');
    assert.equal(ab.restSec, WINDOW_MS / 1000 - 1, 'Retry-After names the end of the window');
    const neu = await claim(a, eins, 'GET', '/sets', now + WINDOW_MS);
    assert.deepEqual([neu.erlaubt, neu.units, neu.restSec], [true, 1, WINDOW_MS / 1000]);
  });

  await t.test('the job pot applies before the general budget, across instances', async () => {
    await clear();
    const now = 2_000_000_000_000;
    for (let i = 0; i < JOB_BUDGET; i++)
      assert.equal((await claim(i % 2 ? a : b, eins, 'POST', '/sets/partslist-pdf', now)).erlaubt, true);
    const ab = await claim(a, eins, 'POST', '/sets/partslist-pdf', now);
    assert.deepEqual([ab.erlaubt, ab.auftrag], [false, true]);
    assert.equal(ab.units, JOB_BUDGET * COST.auftrag, 'otherwise the general budget would have closed, not the bucket');
    assert.equal((await claim(b, eins, 'GET', '/sets', now)).erlaubt, true);
  });

  // The tickets as the voucher routes use them: issued with the approval, redeemed by the GET.
  await q.asAccount(eins, () =>
    a.dienste.vouchers.createVoucher(eins, { number: '6299-0000-0001', pin: null, amount: 5, currency: 'CHF' }),
  );
  const ticketOn = inst => q.asAccount(eins, () => inst.dienste.vouchers.releaseExport(eins));
  const redeem = (inst, konto, ticket, ziel = 'export') =>
    q.asAccount(konto, () => inst.dienste.vouchers.redeemTicket(ticket, konto, ziel));

  await t.test('a ticket issued on A is redeemed once on B', async () => {
    const ticket = await ticketOn(a);
    assert.equal(await redeem(b, eins, ticket), true);
    assert.equal(await redeem(a, eins, ticket), false, 'a second time');
    assert.equal(await data.get('SELECT count(*)::int AS n FROM pdf_tickets').then(r => r.n), 0);
  });

  await t.test('only for its account and target', async () => {
    const ticket = await ticketOn(a);
    assert.equal(await redeem(b, zwei, ticket), false, 'foreign account');
    assert.equal(await redeem(b, eins, ticket, '12'), false, 'different target');
  });

  await t.test('after 60 s it no longer applies (set clock instead of waiting)', async () => {
    const ticket = await ticketOn(a);
    b.clock.ago(61_000);
    assert.equal(await redeem(b, eins, ticket), false);
    // The cleanup in the system frame removes what nobody redeemed.
    await ticketOn(a);
    a.clock.ago(61_000);
    const { inSystemContext } = _req('src/infra/accountContext.js');
    assert.equal(await inSystemContext('Test', () => a.dienste.vouchers.cleanupTickets()), 1);
  });

  await t.test('two real servers answer at the same time', async () => {
    const freePort = () =>
      new Promise(r => {
        const s = net.createServer().listen(0, () => {
          const p = portOf(s);
          s.close(() => r(p));
        });
      });
    const starte = async () => {
      const port = await freePort();
      const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SESSION_SECRET: 'zwei-instanzen-test-geheimnis-lang-genug',
          PORT: String(port),
          ROLE: 'web',
          NODE_ENV: 'production',
          DB_SUPERUSER_ALLOWED: '1',
          APP_BASE_URL_MISSING_OK: '1',
          COOKIE_SECURE: '0',
        },
      });
      let log = '';
      srv.stdout.on('data', d => {
        log += d;
      });
      srv.stderr.on('data', d => {
        log += d;
      });
      t.after(() => {
        if (srv.exitCode === null) srv.kill('SIGKILL');
      });
      return {
        lebt: async () => (await fetch(`http://127.0.0.1:${port}/api/v2/health/live`).catch(() => null))?.ok === true,
        log: () => log,
      };
    };
    const [x, y] = await Promise.all([starte(), starte()]);
    assert.ok(await bis(x.lebt, 60_000), x.log().slice(-1500));
    assert.ok(await bis(y.lebt, 60_000), y.log().slice(-1500));
    assert.deepEqual([await x.lebt(), await y.lebt()], [true, true]);
  });
});
