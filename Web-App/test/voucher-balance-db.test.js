/**
 * The balance query via its real address — throttle included.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources, testContext } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');
const S = _req('src/vouchers/balanceThrottle.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let MAIN = 0,
  FREMD = 0;
let WITH_PIN = 0,
  WITHOUT_PIN = 0,
  FOREIGN = 0;

const NUMBER = '5045076374450011166';
const PIN = '5225';

// ── The replacement for fetch ───────────────────────────────────────────────────
const protokoll = [];
/** What the next balance query should answer. */
let nextResponse = null;

function response({ status = 200, json = {}, text = '', cookies = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text || JSON.stringify(json),
    json: async () => json,
    headers: { getSetCookie: () => cookies },
  };
}

function jwt(seconds) {
  const kopf = Buffer.from('{"alg":"none"}').toString('base64url');
  const useIt = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + seconds,
    }),
  ).toString('base64url');
  return `${kopf}.${useIt}.x`;
}

function guthaben(cent, currency = 'CHF', text = null) {
  return response({
    json: {
      data: {
        giftCard: {
          balance: {
            centAmount: cent,
            currencyCode: currency,
            formattedAmount: text ?? `${currency} ${(cent / 100).toFixed(2)}`,
          },
        },
      },
    },
  });
}

// The fetch to LEGO, set up at the wiring: the route passes none through.
testSources(null, {
  legoFetch: async url => {
    const s = String(url);
    protokoll.push(s);
    if (s.includes('/gift-cards/balance')) return response({ text: '<html></html>' });
    if (s.includes('/Login')) return response({ cookies: [`gqauth=${jwt(3600)}; Path=/`] });
    return nextResponse ?? guthaben(25000);
  },
});

/** The number of queries to the balance endpoint (not page/login). */
const queryList = () => protokoll.filter(u => u.includes('giftCardBalanceQuery')).length;

async function setup() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('fremd','x')`);
  MAIN = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  FREMD = (await db.get(`SELECT id FROM users WHERE username='fremd'`)).id;

  const { createVoucher } = require('./helpers/sources').testArea('vouchers').vouchers;
  WITH_PIN = (await createVoucher(MAIN, { number: NUMBER, pin: PIN, amount: 100, currency: 'CHF' })).id;
  WITHOUT_PIN = (await createVoucher(MAIN, { number: '5045076374450022277', pin: null, amount: 50, currency: 'CHF' }))
    .id;
  FOREIGN = (await createVoucher(FREMD, { number: '9999999999999999999', pin: '0000', amount: 99, currency: 'CHF' }))
    .id;
}

/** Reset the throttle — otherwise every case stands in the shadow of the previous one. */
async function limitFree() {
  await S.forgetThrottle();
  testContext('vouchers')
    .faecher.slot('voucherBalanceSessions', () => new Map())
    .clear();
}

/**
 * Artificially age the time of the last fetch.
 *
 * Really waiting 30 seconds would be a test that stands still for half a minute
 * — a minute with two cases, and the run has 1400 tests. The
 * clock of the throttle stands in the database, so the aging happens there; thus
 * exactly the calculation that applies in production is checked.
 */
async function lastFetchBefore(seconds) {
  await db.run(
    `UPDATE voucher_balance_throttle
        SET last_checked_at = NOW() - make_interval(secs => $1) WHERE id = 1`,
    [seconds],
  );
}

test('balance: the route and the barrier', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await setup();

  const srv = testServer(_req, { sitzung: { userId: MAIN }, t });
  const fremdSrv = testServer(_req, { sitzung: { userId: FREMD }, t });

  const abfrage = (basis, id) => fetch(`${basis}/api/v2/vouchers/${id}/balance`, { method: 'POST' });

  await t.test('1. the queried amount lands in the amount field', async () => {
    await limitFree();
    nextResponse = guthaben(25000, 'CHF', 'CHF 250.00');
    const r = await abfrage(srv.base, WITH_PIN);
    const d = await r.json();
    assert.equal(r.status, 200, `response ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(
      d.voucher.amount,
      250,
      'What Marco asked for: „Der Zurückgemeldete Betrag soll im Feld Betrag ' +
        'gespeichert werden." 25000 Rappen are 250.',
    );
    assert.equal(
      d.displayed,
      'CHF 250.00',
      "The other side's formatted text goes out TOO — it is the form " + 'in which it would appear on the LEGO page.',
    );
    assert.equal(d.currency_changed, false);

    const z = await db.get('SELECT amount, currency, balance_checked_at, updated_at FROM vouchers WHERE id=$1', [
      WITH_PIN,
    ]);
    assert.equal(Number(z.amount), 250, 'The table holds the new amount');
    assert.equal(z.currency, 'CHF');
    assert.ok(
      z.balance_checked_at,
      'guthaben_geprueft_am is empty. Without the timestamp „250 CHF" is no ' +
        'information — nobody knows how old the state is.',
    );
    assert.ok(
      d.voucher.balance_checked_at,
      'The timestamp must also go OUT, otherwise the interface cannot show the ' + 'state.',
    );
  });

  await t.test('2. the second query bounces off the barrier — without a call', async () => {
    const vorher = queryList();
    const r = await abfrage(srv.base, WITH_PIN);
    const d = await r.json();
    assert.equal(r.status, 429, `response ${r.status} instead of 429: ${JSON.stringify(d)}`);
    assert.equal(d.reason, 'abstand');
    assert.ok(
      d.waitSeconds > 0 && d.waitSeconds <= S.GAP_SEC,
      `wartenSek = ${d.waitSeconds} — expected 1…${S.GAP_SEC}`,
    );
    assert.ok(/30/.test(d.error), `The sentence does not name the limit: ${d.error}`);
    assert.equal(
      queryList(),
      vorher,
      'A call went out although the gate was closed. That is exactly ' +
        'what Marco asked for: „maximal 1 Request pro 30sek".',
    );
  });

  await t.test('3. the limit applies ACROSS ALL USERS', async () => {
    // Marco's addendum: „(über alle Benutzer)". A counter per account or per
    // worker process would be green here and in truth N times as high.
    const vorher = queryList();
    const r = await abfrage(fremdSrv.base, FOREIGN);
    const d = await r.json();
    assert.equal(
      r.status,
      429,
      `The FOREIGN account got ${r.status}. Then the gate counts per account — ` +
        'with two accounts that would be two calls in 30 seconds, with ten ten.',
    );
    assert.equal(d.reason, 'abstand');
    assert.equal(queryList(), vorher, 'And nothing went out in the process');
  });

  await t.test('4. after 31 seconds the slot is free again', async () => {
    await lastFetchBefore(31);
    nextResponse = guthaben(12345);
    const r = await abfrage(srv.base, WITH_PIN);
    assert.equal(r.status, 200, `response ${r.status} — the slot should be free`);
    assert.equal(
      Number((await db.get('SELECT amount FROM vouchers WHERE id=$1', [WITH_PIN])).amount),
      123.45,
      'And the new amount is in the table',
    );
  });

  await t.test('5. without a PIN nothing is asked at all — and the slot stays free', async () => {
    await limitFree();
    const vorher = queryList();
    const r = await abfrage(srv.base, WITHOUT_PIN);
    const d = await r.json();
    assert.equal(r.status, 400, `response ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.code, 'balance_pin_missing');
    assert.equal(queryList(), vorher, 'Without a PIN LEGO has nothing to answer');
    // And now the actual point: the refusal must NOT have used up the one slot per
    // 30 seconds.
    nextResponse = guthaben(777);
    const r2 = await abfrage(srv.base, WITH_PIN);
    assert.equal(
      r2.status,
      200,
      `response ${r2.status} — a query that never took place took the ` +
        'slot. Then every voucher without a PIN costs half a minute.',
    );
  });

  await t.test('6. a foreign voucher is not reachable', async () => {
    await limitFree();
    const vorher = queryList();
    const r = await abfrage(srv.base, FOREIGN);
    assert.equal(
      r.status,
      404,
      `response ${r.status}. A voucher carries number and PIN — foreign access ` +
        'would be handing over a means of payment.',
    );
    assert.equal(queryList(), vorher);
  });

  await t.test('7. an unknown issuing country stops the query', async () => {
    await limitFree();
    await db.run(
      `INSERT INTO global_settings (key,value) VALUES ('voucher_country','de-XX')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    const vorher = queryList();
    const r = await abfrage(srv.base, WITH_PIN);
    const d = await r.json();
    assert.equal(r.status, 400, `response ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.code, 'balance_country_invalid');
    assert.equal(
      queryList(),
      vorher,
      'A query was made with a country that does not exist — the address for it ' +
        'does not exist at LEGO, and the refusal belongs BEFORE the call.',
    );
    await db.run(`DELETE FROM global_settings WHERE key='voucher_country'`);
  });

  await t.test('8. the configured country really goes along', async () => {
    await limitFree();
    await db.run(
      `INSERT INTO global_settings (key,value) VALUES ('voucher_country','de-DE')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    protokoll.length = 0;
    nextResponse = guthaben(5000, 'EUR');
    const r = await abfrage(srv.base, WITH_PIN);
    const d = await r.json();
    assert.equal(r.status, 200, `response ${r.status}: ${JSON.stringify(d)}`);
    assert.ok(
      protokoll.some(u => u.includes('/de-de/gift-cards/balance')),
      `The balance page was not loaded for de-DE: ${JSON.stringify(protokoll)}. ` +
        'A card is only valid in the shop of its issuing country — the country is not decoration.',
    );
    // And the currency of the other side wins, but not silently.
    assert.equal(d.voucher.currency, 'EUR');
    assert.equal(d.currency_changed, true, 'A changed currency is a changed amount — it must be reported.');
    await db.run(`DELETE FROM global_settings WHERE key='voucher_country'`);
    await db.run(`UPDATE vouchers SET currency='CHF' WHERE id=$1`, [WITH_PIN]);
  });

  await t.test('9. bot protection: the query rests afterwards — for other accounts too', async () => {
    await limitFree();
    nextResponse = response({ status: 403, text: 'Attention Required! Cloudflare' });
    const r = await abfrage(srv.base, WITH_PIN);
    const d = await r.json();
    assert.equal(r.status, 429, `response ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.reason, 'botschutz');
    assert.ok(d.waitSeconds > 60, `wartenSek = ${d.waitSeconds} — a bot block is not a matter of seconds`);
    assert.ok(/Bot|bot/.test(d.error), `The sentence does not say what it is about: ${d.error}`);

    // The slot is still closed after 31 seconds: the LOCK applies, not the
    // distance. Exactly that is Marco's „dass nicht mehr Aufrufe generiert werden".
    await lastFetchBefore(31);
    const vorher = queryList();
    nextResponse = guthaben(25000);
    const r2 = await abfrage(srv.base, WITH_PIN);
    const d2 = await r2.json();
    assert.equal(r2.status, 429, `response ${r2.status}: ${JSON.stringify(d2)}`);
    assert.equal(d2.reason, 'botschutz', 'After a bot protection hit the pause applies');
    assert.equal(queryList(), vorher, 'And nothing goes out in the process');

    // The same for the foreign account — the lock is installation-wide.
    const r3 = await abfrage(fremdSrv.base, FOREIGN);
    assert.equal(r3.status, 429);
    assert.equal((await r3.json()).reason, 'botschutz');
    assert.equal(queryList(), vorher);
  });

  await t.test('10. an exhausted card: 0 is saved and stays editable', async () => {
    await limitFree();
    nextResponse = guthaben(0);
    const r = await abfrage(srv.base, WITH_PIN);
    const d = await r.json();
    assert.equal(r.status, 200, `response ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(
      d.voucher.amount,
      0,
      'A card without a balance is INFORMATION — „0" is the result, not ' + 'an error of the query.',
    );

    // And the postscript that would have slipped through without re-measuring: checkValues
    // rejects amount <= 0. Whoever changes the PIN afterwards sends no amount
    // along — the stored 0 would go through the same check.
    const p = await fetch(`${srv.base}/api/v2/vouchers/${WITH_PIN}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '9999' }),
    });
    const pd = await p.json();
    assert.equal(
      p.status,
      200,
      `Changing answered ${p.status}: ${JSON.stringify(pd)} — a card spent ` +
        'down to zero could then no longer be edited.',
    );
    assert.equal(pd.voucher.pin, '•••', 'only the mask to the outside');
    const gespeichert = await db.get('SELECT user_id, pin FROM vouchers WHERE id=$1', [WITH_PIN]);
    assert.equal(
      _req('src/infra/secret.js').decrypt(
        gespeichert.pin,
        _req('src/vouchers/repository/vouchers.js').pinContext(gespeichert.user_id, WITH_PIN),
      ),
      '9999',
    );
    assert.equal(pd.voucher.amount, 0, 'And the amount stays what it was');
    // A zero amount typed in by hand stays forbidden.
    const n = await fetch(`${srv.base}/api/v2/vouchers/${WITH_PIN}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0 }),
    });
    assert.equal(
      n.status,
      400,
      'A self-entered 0 must still fail — otherwise a ' + 'forgotten field silently creates a voucher over nothing.',
    );
  });

  await t.test('11. an error of the other side is reported, not swallowed', async () => {
    await limitFree();
    // The PIN is read FROM THE TABLE and not from the constant above:
    // case 10 changed it to „9999". My first draft took `PIN` and
    // reported a leak that did not exist — the text contained a digit sequence
    // that was no longer the PIN of this card at all. The assertion must check against
    // THE value that the route passes to verdecke().
    const pinRow = await db.get('SELECT user_id, pin FROM vouchers WHERE id=$1', [WITH_PIN]);
    const pinNow = _req('src/infra/secret.js').decrypt(
      pinRow.pin,
      _req('src/vouchers/repository/vouchers.js').pinContext(pinRow.user_id, WITH_PIN),
    );
    nextResponse = response({ status: 500, text: `kaputt für ${NUMBER} mit ${pinNow}` });
    const r = await abfrage(srv.base, WITH_PIN);
    const d = await r.json();
    assert.equal(r.status, 502, `response ${r.status}: ${JSON.stringify(d)}`);
    assert.equal(d.code, 'balance_failed');
    assert.ok(!d.error.includes(pinNow), `The PIN is in the response to the browser: ${d.error}`);
    assert.ok(!d.error.includes(NUMBER), `The whole card number is in the response: ${d.error}`);
    assert.ok(d.error.includes('1166'), 'The last four digits may stay — otherwise nobody knows which card');

    // The slot IS used up: the request was sent.
    const vorher = queryList();
    const r2 = await abfrage(srv.base, WITH_PIN);
    assert.equal(
      r2.status,
      429,
      'A failed call must use up the slot — otherwise ' +
        'the limit could be bypassed any number of times by failing repeatedly.',
    );
    assert.equal(queryList(), vorher);
  });

  // Counter-checks (measured 02.11.2026): the check kontoStand() removed from claimSlot()
  // → red (200 instead of 429); zaehleKonto() removed → red (“a query
  // counts for its account”); the account check put AFTER the lock → red (grund
  // „botschutz“ instead of „konto“).
  await t.test('12. the per-account limit applies before the one for all and before bot protection', async () => {
    const zaehler = async uid =>
      (await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [`guthaben-konto|${uid}`]))?.count ?? 0;
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'guthaben-konto|%'");
    await limitFree();
    nextResponse = guthaben(1000);
    assert.equal((await abfrage(srv.base, WITH_PIN)).status, 200);
    assert.equal(await zaehler(MAIN), 1, 'a query counts for its account');

    await db.run('UPDATE rate_limit_attempts SET count = $2 WHERE key = $1', [
      `guthaben-konto|${MAIN}`,
      S.ACCOUNT_PER_HOUR,
    ]);
    await limitFree();
    await db.run(`UPDATE voucher_balance_throttle SET locked_until = NOW() + INTERVAL '10 minutes' WHERE id = 1`);
    const vorher = queryList();
    const r = await abfrage(srv.base, WITH_PIN);
    const d = await r.json();
    assert.equal(r.status, 429, JSON.stringify(d));
    assert.equal(d.reason, 'konto');
    assert.equal(d.code, 'too_many_requests');
    assert.ok(d.waitSeconds > 0 && d.waitSeconds <= 3600, String(d.waitSeconds));
    assert.equal(queryList(), vorher, 'despite the limit a query went out');

    await limitFree();
    nextResponse = response({ status: 403, text: 'Bot' });
    assert.equal((await abfrage(srv.base, WITH_PIN)).status, 429);
    const s = await db.get('SELECT last_checked_at, locked_until FROM voucher_balance_throttle WHERE id = 1');
    assert.deepEqual(
      s,
      { last_checked_at: null, locked_until: null },
      'the locked account takes the slot or triggers the pause',
    );
    nextResponse = guthaben(9900);
    const fremd = await abfrage(fremdSrv.base, FOREIGN);
    assert.equal(fremd.status, 200, 'another account is held up by the limit of the first');
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'guthaben-konto|%'");
  });
});
