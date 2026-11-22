/**
 * A currency change triggers the price job — against real routes and table.
 *
 * Counter-check (performed): the trigger removed in setUserSetting() →
 * the two “triggers" steps here turn red. Repeated on 30.10.2026 with the
 * scheduled job: preisJobAnstossen in startup/wiring.ts empty
 * → red: “EUR → CHF must trigger the price job”. On 15.11.2026 (event instead of
 * follow-up work): onCurrencyChange() deleted in createJobs → red, the same case.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

test('a real currency change triggers the price job, a no-op save does not', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  // What is observed is the date of the scheduled job 'prices'.
  const Z = _req('src/jobQueue/schedule.js');
  await db.run(`DELETE FROM jobs WHERE type = 'prices'`);
  await Z.planeNext('prices');
  const spaeter = () =>
    db.run(`UPDATE jobs SET due_at = NOW() + INTERVAL '1 hour' WHERE type = 'prices' AND status = 'pending'`);
  const faellig = async () =>
    (await db.get(`SELECT due_at <= NOW() AS now FROM jobs WHERE type = 'prices' AND status = 'pending'`))?.now ===
    true;
  const waitOnRun = async () => {
    for (let i = 0; i < 40; i++) {
      if (await faellig()) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  };

  const USERNAME = 'currencytest';
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await db.run(`INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1,'x',false,true)`, [
    USERNAME,
  ]);
  const uid = (await db.get(`SELECT id FROM users WHERE username = $1`, [USERNAME])).id;
  await db.run(
    `INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','EUR')
     ON CONFLICT (user_id, key) DO UPDATE SET value='EUR'`,
    [uid],
  );

  const { base, srv } = testServer(_req, { sitzung: { userId: uid, username: USERNAME, isAdmin: false }, t });

  const postWeb = body =>
    fetch(`${base}/api/v2/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    // 1) Real change via the web app route → the date is now.
    assert.equal(await faellig(), false, 'Vorbedingung: der Lauf liegt in der Zukunft');
    let r = await postWeb({ currency: 'CHF' });
    assert.equal(r.status, 200);
    assert.ok(await waitOnRun(), 'EUR → CHF muss den Preis-Job anstossen');
    assert.equal(
      (await db.get(`SELECT value FROM user_settings WHERE user_id=$1 AND key='currency'`, [uid])).value,
      'CHF',
    );

    // 2) The same currency again (the form always sends all fields) → no run.
    await spaeter();
    r = await postWeb({ currency: 'CHF', language: 'de' });
    assert.equal(r.status, 200);
    await new Promise(res => setTimeout(res, 700));
    assert.equal(await faellig(), false, 'ein Speichern OHNE Währungsänderung darf keinen Lauf kosten');

    // 3) Parity: the same rule on the v1 route.
    r = await fetch(`${base}/api/v2/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency: 'EUR' }),
    });
    assert.equal(r.status, 200, `v1-Settings-Route antwortete ${r.status}`);
    assert.ok(await waitOnRun(), 'CHF → EUR über /api/v1 muss den Preis-Job ebenfalls anstossen');
  } finally {
    await db.run(`DELETE FROM jobs WHERE type = 'prices'`);
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
