/**
 * "Remove empty vouchers": with the account's switch on, a card whose balance query
 * reports exactly 0.00 is soft-deleted after the query (route, i.e. the run button) and
 * after the nightly job voucher_balances; never on a failed query, never with the switch
 * off, never for another account. The nightly run goes through the same throttle as the
 * button and schedules its next night. LEGO is replaced at the wiring (testSources).
 *
 * Counter-checks (measured 27.11.2026, each alone, dist rebuilt):
 *   A  removeIfEmpty() (src/vouchers/service.ts) returns false right away → red: “switch on:
 *      the run button removes …”, “nightly run …” and “the scheduled job …”
 *   B  `amount !== 0 ||` dropped from removeIfEmpty() → red: “switch on: a card with a balance stays”
 *      and “nightly run …” (the full card gone)
 *   C  the setting check dropped from removeIfEmpty() → red: “switch off: …” and “nightly run …”
 *      (account B's empty card gone)
 *   D  the try/catch in lookup() (src/vouchers/nightlyBalances.ts) removed → red: “nightly run …”
 *      (the run aborts at the failing card)
 *   E  in oneCard() a throttle answer returns 'failed' instead of pausing → red: “nightly run …”
 *      (no pause, later cards unchecked)
 *   F  `schedule` removed from the job kind voucher_balances → red: “the scheduled job …”
 *   G  inNamesOfJob() in nightlyBalances() replaced by a plain call → red: “nightly run …”
 *      (the lookups run without the account's row security)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const {
  buildAndRequire,
  testData,
  testSources,
  testServices,
  testContext,
  testAccess,
  asAccount,
} = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { until } = require('./helpers/time');
const db = testData();
const S = _req('src/vouchers/balanceThrottle.js');
const { rowsContext } = _req('src/infra/accountContext.js');

function response({ status = 200, json = {}, text = '', cookies = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text || JSON.stringify(json),
    json: async () => json,
    headers: { getSetCookie: () => cookies },
  };
}
const jwt = () =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url')}.x`;
const balance = cent =>
  response({ json: { data: { giftCard: { balance: { centAmount: cent, currencyCode: 'CHF' } } } } });
const failure = () => response({ json: { errors: [{ message: 'card unknown' }] } });

/** Per card number what LEGO answers; unknown numbers report 10.00. */
const answers = new Map();
/** Card number and the row-security account in effect at each balance lookup. */
const lookups = [];
testSources(null, {
  legoFetch: async (url, init) => {
    const s = String(url);
    if (s.includes('/gift-cards/balance')) return response({ text: '<html></html>' });
    if (s.includes('/Login')) return response({ cookies: [`gqauth=${jwt()}; Path=/`] });
    const body = String(init?.body ?? '');
    const number = [...answers.keys()].find(n => body.includes(n)) ?? null;
    lookups.push({ number, account: rowsContext().account, system: rowsContext().system });
    return (number && answers.get(number)()) || balance(1000);
  },
});

async function throttleFree() {
  await S.forgetThrottle();
  testContext('vouchers')
    .compartments.slot('voucherBalanceSessions', () => new Map())
    .clear();
}

let n = 0;
const number = () => `50450763744${String(process.pid % 1000).padStart(3, '0')}${String(++n).padStart(5, '0')}`;
const card = (uid, num, answer) => {
  answers.set(num, answer);
  return asAccount(uid, () => testServices().vouchers.createVoucher(uid, { number: num, pin: '1234', amount: 50 }));
};
const live = async id => (await db.get('SELECT deleted_at FROM vouchers WHERE id = $1', [id]))?.deleted_at === null;

test('remove empty vouchers', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const names = [`rev-a-${process.pid}`, `rev-b-${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]);
  const ids = [];
  for (const name of names)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name])).id);
  const [uidA, uidB] = ids;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]);
    await db.run(`DELETE FROM jobs WHERE type = 'voucher_balances'`);
    await testAccess()
      .notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const srvA = testServer(_req, { session: { userId: uidA }, t });
  const call = async (method, p, body) => {
    const r = await fetch(`${srvA.base}/api/v2${p}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, d: await r.json() };
  };
  const query = id => call('POST', `/vouchers/${id}/balance`);
  const listed = async () => (await call('GET', '/vouchers')).d.vouchers.map(v => v.id);

  await t.test('switch off: an empty card stays after the query', async () => {
    await throttleFree();
    const id = (await card(uidA, number(), () => balance(0))).id;
    const { status, d } = await query(id);
    assert.equal(status, 200, JSON.stringify(d));
    assert.equal(d.voucher.amount, 0);
    assert.equal(d.removed, false);
    assert.ok(await live(id));
    assert.equal((await call('GET', '/settings')).d.settings.remove_empty_vouchers, false);
  });

  await t.test('the switch is saved by the web form and by the app', async () => {
    assert.equal((await call('POST', '/settings', { remove_empty_vouchers: '1' })).status, 200);
    assert.equal((await call('GET', '/settings')).d.settings.remove_empty_vouchers, true);
    assert.equal((await call('PUT', '/settings', { remove_empty_vouchers: false })).status, 200);
    assert.equal((await call('GET', '/settings')).d.settings.remove_empty_vouchers, false);
    assert.equal((await call('PUT', '/settings', { remove_empty_vouchers: true })).status, 200);
    assert.equal((await call('GET', '/settings')).d.settings.remove_empty_vouchers, true);
    assert.equal((await call('POST', '/settings', { remove_empty_vouchers: 'ja' })).status, 400);
  });

  await t.test('switch on: the run button removes an empty card, restorable like a delete', async () => {
    await throttleFree();
    const id = (await card(uidA, number(), () => balance(0))).id;
    const { status, d } = await query(id);
    assert.equal(status, 200, JSON.stringify(d));
    assert.equal(d.removed, true);
    assert.ok(!(await live(id)), 'soft-deleted');
    assert.ok(!(await listed()).includes(id));
    assert.equal((await call('POST', `/vouchers/${id}/restore`)).status, 200);
    assert.ok((await listed()).includes(id));
  });

  await t.test('switch on: a card with a balance stays', async () => {
    await throttleFree();
    const id = (await card(uidA, number(), () => balance(1))).id;
    const { d } = await query(id);
    assert.equal(d.voucher.amount, 0.01);
    assert.equal(d.removed, false);
    assert.ok(await live(id));
  });

  await t.test('switch on: a failed query never removes', async () => {
    await throttleFree();
    const id = (await card(uidA, number(), failure)).id;
    const { status } = await query(id);
    assert.notEqual(status, 200);
    assert.ok(await live(id));
  });

  await t.test('nightly run: every account in turn, through the throttle, only own switch', async () => {
    await db.run('UPDATE vouchers SET deleted_at = NOW() WHERE user_id = ANY($1) AND deleted_at IS NULL', [ids]);
    await throttleFree();
    const emptyA = (await card(uidA, number(), () => balance(0))).id;
    const failingA = (await card(uidA, number(), failure)).id;
    const fullA = (await card(uidA, number(), () => balance(2500))).id;
    const emptyB = (await card(uidB, number(), () => balance(0))).id;
    lookups.length = 0;
    const pauses = [];
    // Instead of waiting 30 s: note the requested pause, then free the slot as time would.
    const pause = async seconds => {
      pauses.push(seconds);
      await S.forgetThrottle();
    };
    const run = { signal: new AbortController().signal, progress: async () => true };
    const { nightlyBalances } = _req('src/vouchers/nightlyBalances.js');
    // In the job's own frame, as the worker runs it (crossAccount).
    const report = await testServices().jobQueue.inNamesOfJob({ type: 'voucher_balances', user_id: null }, () =>
      nightlyBalances(run, pause),
    );
    const ours = lookups.filter(l => l.number);
    assert.ok(report.checked >= 2 && report.removed >= 1 && report.failed >= 1, JSON.stringify(report));
    assert.ok(
      report.errors.some(e => e.startsWith(`voucher ${failingA}: `)),
      'the reason reaches the report',
    );
    assert.ok(pauses.length >= 3 && pauses.every(s => s > 0 && s <= 30), `pauses ${pauses}`);
    assert.ok(!(await live(emptyA)), 'A: empty card removed');
    assert.ok(await live(failingA), 'A: failed card stays');
    assert.ok(await live(fullA), 'A: card after the failing one checked and kept');
    assert.equal(Number((await db.get('SELECT amount FROM vouchers WHERE id = $1', [fullA])).amount), 25);
    assert.ok(await live(emptyB), 'B: switch off, empty card stays');
    assert.ok(
      ours.length >= 4 && ours.every(l => !l.system && [uidA, uidB].includes(l.account)),
      `lookups under the account's row security: ${JSON.stringify(ours)}`,
    );
  });

  await t.test('the scheduled job removes empty cards and schedules the next night', async () => {
    await db.run('UPDATE vouchers SET deleted_at = NOW() WHERE deleted_at IS NULL');
    await db.run(`DELETE FROM jobs WHERE type = 'voucher_balances'`);
    await throttleFree();
    const id = (await card(uidA, number(), () => balance(0))).id;
    const d = testServices();
    await d.jobQueue.pullPlanBefore('voucher_balances', 0);
    const worker = _req('jobs/startJobs.js').startJobWorker(d, { kinds: ['voucher_balances'], tickMs: 50 });
    const plan = () =>
      db.get(
        `SELECT due_at, EXTRACT(EPOCH FROM due_at - NOW())::int AS in_sec FROM jobs
          WHERE dedupe_key = 'plan:voucher_balances' AND status = 'pending'`,
      );
    try {
      await until(async () => !(await live(id)), 10_000);
      await until(async () => (await plan())?.in_sec > 60, 10_000);
    } finally {
      await worker.stop(0);
    }
    assert.ok(!(await live(id)), 'removed by the job');
    const p = await plan();
    assert.ok(p && p.in_sec > 60 && p.in_sec <= 24 * 3600, `next run in ${p?.in_sec} s`);
    const at = new Date(p.due_at);
    assert.deepEqual([at.getHours(), at.getMinutes()], [2, 0]);
  });
});
