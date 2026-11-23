/**
 * Price alert against a real database.
 *
 * Counter-check: in src/finances/priceAlert.ts an already triggered alert reports again → red “the TRANSITION is reported, not the state”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();

const U = {};
const SN = '10179-1';

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  for (const [name, mail] of [
    ['ich', 'ich@example.test'],
    ['noMail', null],
  ]) {
    await db.run(`INSERT INTO users (username, email, password_hash) VALUES ($1,$2,'x')`, [name, mail]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
}

/** Set the market price — what the price run otherwise fetches from BrickLink. */
async function setPrice(price, condition = 'N', currency = 'EUR') {
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, avg_price, fetched_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (set_number, currency_code, condition)
       DO UPDATE SET avg_price = $4, fetched_at = NOW()`,
    [SN, condition, currency, price],
  );
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('price alert against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await seed();

  // The sending is passed as a PARAMETER, not replaced.
  //
  // The first draft replaced `mailer.sendMail`. That fizzles out silently:
  // TypeScript compiles `export { sendMail }` into a getter on the
  // module object, and an assignment to it does nothing. The test ran against the
  // real sending, counted zero messages — and the cause stood nowhere.
  const A = {
    ..._req('src/finances/priceAlert.js'),
    ...require('./helpers/sources').testArea('finances').priceAlert,
  };
  let sent = [];
  let sendingError = null;
  const send = async m => {
    if (sendingError) throw new Error(sendingError);
    sent.push(m);
  };
  const check = sn => A.checkSet(sn, { ...require('./helpers/sources').testServices().mail, sendMail: send });

  await t.test('the direction means what it says', () => {
    // The only place in the module where a sign error arises.
    assert.equal(A.crosses('below', 199, 200), true);
    assert.equal(A.crosses('below', 200, 200), false, 'exactly at the threshold is not below');
    assert.equal(A.crosses('below', 201, 200), false);
    assert.equal(A.crosses('above', 201, 200), true);
    assert.equal(A.crosses('above', 200, 200), false, 'exactly at the threshold is not above');
    assert.equal(A.crosses('above', 199, 200), false);
  });

  await t.test('nonsensical input is rejected, not bent into shape', async () => {
    // A silently corrected threshold would be worse than a
    // refusal: the alert would stand there and report never or always.
    for (const [field, value] of [
      ['direction', 'seitwärts'],
      ['threshold', 0],
      ['threshold', -5],
      ['threshold', 'abc'],
      ['condition', 'X'],
    ]) {
      const input = { direction: 'below', threshold: 200, condition: 'N', [field]: value };
      // Checked on `code`, not on the message: fachfehler() sets as
      // `message` the GERMAN sentence — a test on it would break on every
      // rephrasing without the behavior changing.
      await assert.rejects(
        () => A.setAlert(U.ich, SN, 'EUR', input),
        (/** @type {any} */ e) => String(e.code || '').startsWith('alert_'),
        `${field}=${value} was accepted`,
      );
    }
  });

  await t.test('the TRANSITION is reported, not the state', async () => {
    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });

    // 1. Above the threshold — nothing to report.
    await setPrice(250);
    assert.equal(await check(SN), 0, 'above the threshold nothing may come');

    // 2. Falling below — one message.
    await setPrice(180);
    assert.equal(await check(SN), 1, 'going below was not reported');
    assert.match(sent.at(-1).subject, /10179-1/);

    // 3. Stays below — NO second message. Without this marker an hourly
    //    price run would produce a mail every hour.
    await setPrice(170);
    assert.equal(await check(SN), 0, 'second message without a new transition');

    // 4. Back above — the marker falls.
    await setPrice(260);
    assert.equal(await check(SN), 0);
    const nach = (await A.alertsFor(U.ich, SN))[0];
    assert.equal(nach.triggered, false, 'the marker was not reset');

    // 5. Below again — again a message. Exactly this is swallowed by a
    //    blocking period („at most once a week"), and exactly this is the
    //    case that is interesting again.
    await setPrice(150);
    assert.equal(await check(SN), 1, 'the second drop below was swallowed');
  });

  await t.test('a new threshold is a new question', async () => {
    // After check 5 the marker stands. Whoever changes the threshold wants an
    // answer — even if the old one has already reported once.
    await setPrice(150);
    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 160, condition: 'N' });
    assert.equal((await A.alertsFor(U.ich, SN))[0].triggered, false);
    assert.equal(await check(SN), 1, 'after the change it was not reported again');
  });

  await t.test('the currency belongs to the threshold', async () => {
    // 200 CHF are not 200 EUR. If there is no price in THE currency of the
    // alert, it is not wrong — only not answerable (yet).
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [U.ich]);
    await A.setAlert(U.ich, SN, 'CHF', { direction: 'below', threshold: 200, condition: 'N' });
    await setPrice(10, 'N', 'EUR'); // cheap, but in the wrong currency
    assert.equal(await check(SN), 0, 'a price in a foreign currency triggered');
    await setPrice(10, 'N', 'CHF');
    assert.equal(await check(SN), 1);
  });

  await t.test('the condition separates the alerts', async () => {
    // New and used are often a multiple apart. An alert
    // on „new" must not be triggered by a used price.
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [U.ich]);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });
    await setPrice(50, 'U');
    assert.equal(await check(SN), 0, 'the used price triggered the new-condition alert');
    await setPrice(150, 'N');
    assert.equal(await check(SN), 1);
  });

  await t.test('an account without a mail address does not block the run', async () => {
    // The marker is set nevertheless — otherwise the check would run through
    // all alerts of this account again on every run.
    await db.run('DELETE FROM price_alerts', []);
    await A.setAlert(U.noMail, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });
    await setPrice(100, 'N');
    assert.equal(await check(SN), 0, 'without an address nothing may be sent');
    assert.equal((await A.alertsFor(U.noMail, SN))[0].triggered, true, 'the marker must be set anyway');
  });

  await t.test('a failed send leaves the flag unset', async () => {
    // Otherwise the message would be lost: the marker said „already reported",
    // although no mail ever arrived.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });
    sendingError = 'SMTP weg';
    await setPrice(100, 'N');
    assert.equal(await check(SN), 0);
    assert.equal((await A.alertsFor(U.ich, SN))[0].triggered, false, 'after a failed send the marker must not be set');
    sendingError = null;
    // And on the next run it is tried again.
    assert.equal(await check(SN), 1, 'the second attempt did not happen');
  });

  await t.test('fetch: without a marker nothing comes back, only the timestamp', async () => {
    // That is the first start of a device. If everything triggered came here, a
    // freshly set-up app would land with thresholds that were broken weeks
    // ago.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });
    await setPrice(100, 'N');
    assert.equal(await check(SN), 1);

    for (const without of [undefined, null, '', '   ', 'kein Datum']) {
      const r = await A.triggeredSince(U.ich, without);
      assert.deepEqual(r.alerts, [], `since=${JSON.stringify(without)} returned messages`);
      assert.ok(r.now instanceof Date, "the server's timestamp is missing");
    }
  });

  await t.test('fetch: the server marker fetches exactly once', async () => {
    // The flow of a device: remember, fetch, remember again. The second
    // fetch with the returned marker must be EMPTY — otherwise the
    // same message would come again on every hourly run.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    const prior = (await A.triggeredSince(U.ich, null)).now;

    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });
    await setPrice(100, 'N');
    assert.equal(await check(SN), 1);

    const first = await A.triggeredSince(U.ich, prior);
    // The timestamps here too: a full CI run failed on this subtest
    // once, and the report did not show WHICH
    // of the two assertions broke. Both therefore name their values.
    assert.equal(
      first.alerts.length,
      1,
      'the triggered threshold is missing. ' +
        `prior=${prior?.toISOString?.() ?? prior}, ` +
        `last_triggered_at=${(await db.get('SELECT last_triggered_at FROM price_alerts'))?.last_triggered_at}`,
    );
    assert.equal(first.alerts[0].set_number, SN);
    assert.equal(first.alerts[0].direction, 'below');
    // numeric comes out of the driver as a string — if it came through like that,
    // the message would say "200.00" instead of a number, and the app would compute
    // on a string.
    assert.equal(typeof first.alerts[0].threshold, 'number');
    assert.equal(first.alerts[0].threshold, 200);
    assert.equal(typeof first.alerts[0].last_price, 'number');
    assert.equal(first.alerts[0].last_price, 100);

    const second = await A.triggeredSince(U.ich, first.now);
    // The timestamps stand in the message, and that has a reason: exactly
    // this assertion turned red for me ONCE in a full run and
    // no longer in four repetitions. Without the three values the
    // error report would only say „kam ein zweites Mal" — and with that again nothing to …
    assert.deepEqual(
      second.alerts,
      [],
      'the same message came a second time. ' +
        `prior=${prior?.toISOString?.() ?? prior}, ` +
        `last_triggered_at=${first.alerts[0]?.last_triggered_at?.toISOString?.() ?? first.alerts[0]?.last_triggered_at}, ` +
        `first.now=${first.now?.toISOString?.() ?? first.now}`,
    );
  });

  await t.test('fetch: a notification from the same millisecond does NOT come twice', async () => {
    // The finding, and why it turned the CI red twice
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });

    const WITH_MICRO = '2026-09-19 20:29:58.527431+00';
    const MS_ONLY = new Date('2026-09-19T20:29:58.527Z');
    await db.run(
      `UPDATE price_alerts SET triggered = TRUE, last_triggered_at = $1::timestamptz,
              last_price = 100 WHERE user_id = $2`,
      [WITH_MICRO, U.ich],
    );

    const r = await A.triggeredSince(U.ich, MS_ONLY);
    assert.deepEqual(
      r.alerts,
      [],
      'The message came a second time: the database holds ' +
        `${WITH_MICRO}, the marker carries ${MS_ONLY.toISOString()}. ` +
        'The microseconds decide — they must not.',
    );

    // And the opposite direction must keep working: a message from the
    // NEXT millisecond is really new and belongs delivered.
    const r2 = await A.triggeredSince(U.ich, new Date('2026-09-19T20:29:58.526Z'));
    assert.equal(r2.alerts.length, 1, 'A message after the marker was swallowed — the truncation goes too far');
  });

  await t.test('fetch: every account sees only its own alerts', async () => {
    // The query is on user_id, not on scopeIds() — and that is
    // intended: a message belongs to whoever set the threshold. A
    // main account would otherwise get the messages of all sub-accounts without ever having
    // set an alert.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    const prior = (await A.triggeredSince(U.ich, null)).now;
    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });
    await setPrice(100, 'N');
    assert.equal(await check(SN), 1);

    assert.equal((await A.triggeredSince(U.ich, prior)).alerts.length, 1);
    assert.deepEqual((await A.triggeredSince(U.noMail, prior)).alerts, [], 'a foreign account saw the message');
  });

  await t.test("Marco's four steps — the APP also gets exactly one per transition", async () => {
    // Marco's specification of 25.09.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    sent = [];

    let mark = (await A.triggeredSince(U.ich, null)).now;
    await A.setAlert(U.ich, SN, 'EUR', { direction: 'below', threshold: 200, condition: 'N' });

    /** A price run: set the price, check, fetch. Returns [mails, messages]. */
    const run = async price => {
      sent = [];
      await setPrice(price);
      const mails = await check(SN);
      const r = await A.triggeredSince(U.ich, mark);
      mark = r.now;
      return [mails, r.alerts.length];
    };

    // 1. The price falls below the threshold.
    assert.deepEqual(await run(180), [1, 1], 'step 1: mail AND message expected');

    // 2. Next price run, still below.
    assert.deepEqual(await run(170), [0, 0], 'step 2: nothing expected — no new transition');

    // And a third run stays silent too. Without this step it would remain open whether
    // step 2 only depended on the unchanged number.
    assert.deepEqual(await run(165), [0, 0], 'step 2b: nothing on the third run either');

    // 3. The price rises above again.
    assert.deepEqual(await run(260), [0, 0], 'step 3: returning itself reports nothing');

    // 4. And falls below again — both paths report again.
    assert.deepEqual(await run(150), [1, 1], 'step 4: the second drop below was swallowed');

    // For completeness: whoever does NOT fetch misses nothing. The
    // message stays ready as long as the marker is older — the phone
    // may be off.
    const subsequent = await A.triggeredSince(U.ich, new Date(Date.now() - 60_000));
    assert.equal(subsequent.alerts.length, 1, 'a message expires when the app is not fetching right now');
  });

  await t.test('deleting without an alert is not an error', async () => {
    assert.equal(await A.deleteAlert(U.ich, SN, 'N'), 1);
    assert.equal(await A.deleteAlert(U.ich, SN, 'N'), 0, 'the second call must not throw');
  });

  await db.pool.end().catch(() => {});
});
