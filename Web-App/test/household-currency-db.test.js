/**
 * A currency change applies to the whole household. The household view
 * sums amounts; two currencies in it would give a wrong sum. Only the
 * main account may set it, and every change (a full price run) is
 * throttled.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  in setzeHaushaltswaehrung only write the own account → red: “the
 *      main account's change applies in the whole household”
 *   C  the check hatHauptkonto() removed → red: “a sub-account does not change the
 *      household currency”
 *   D  the throttle removed → red: “at most five changes per hour”
 *   E  (02.11.2026) eigenerHaushalt() undirected again (over main AND
 *      sub-accounts) → red: “a shared sub-account does not drag along a foreign
 *      main account” (Missing expected rejection: erik changes along)
 *   F  (02.11.2026) the check fremdGeteilt() removed → red: the same
 *      check (Missing expected rejection: dora changes without erik)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('household currency', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const namen = ['eltern', 'kind', 'enkel', 'fremd', 'carl', 'dora', 'erik', 'cleo'].map(n => `hw-${n}-${process.pid}`);
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2), ($2, $3)', [
    ids[0],
    ids[1],
    ids[2],
  ]);
  // carl and erik share the sub-account dora; cleo only hangs on carl.
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2), ($3, $2), ($1, $4)', [
    ids[4],
    ids[5],
    ids[6],
    ids[7],
  ]);
  for (const id of ids)
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')`, [id]);
  // A real change pulls the scheduled price job forward; it is not executed here.
  t.after(async () => {
    await db.run(`DELETE FROM jobs WHERE type = 'prices'`);
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'waehrung|%'");
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]);
    await db.pool.end().catch(() => {});
  });
  const { setUserSetting } = _req('src/settings/userSetting.js');
  const currencies = async () =>
    (
      await db.all(
        `SELECT u.id, s.value FROM unnest($1::int[]) WITH ORDINALITY AS u(id, n)
       JOIN user_settings s ON s.user_id = u.id AND s.key = 'currency' ORDER BY u.n`,
        [ids],
      )
    ).map(r => r.value);

  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'waehrung|%'");

  await t.test("the main account's change applies in the whole household", async () => {
    await setUserSetting(ids[0], 'currency', 'CHF');
    assert.deepEqual(
      (await currencies()).slice(0, 4),
      ['CHF', 'CHF', 'CHF', 'EUR'],
      'Eltern, Kind und Enkel müssen dieselbe Währung tragen; das fremde Konto bleibt',
    );
  });

  await t.test('a sub-account does not change the household currency', async () => {
    for (const unter of [ids[1], ids[2]]) {
      await assert.rejects(
        setUserSetting(unter, 'currency', 'USD'),
        (/** @type {any} */ e) => e.code === 'currency_main_account_only' && e.kind === 'forbidden',
      );
    }
    await setUserSetting(ids[1], 'currency', 'CHF');
    assert.deepEqual(
      (await currencies()).slice(0, 4),
      ['CHF', 'CHF', 'CHF', 'EUR'],
      'derselbe Wert bleibt erlaubt und ändert nichts',
    );
  });

  await t.test('the change of an account without a household only affects itself', async () => {
    await setUserSetting(ids[3], 'currency', 'USD');
    assert.deepEqual((await currencies()).slice(0, 4), ['CHF', 'CHF', 'CHF', 'USD']);
  });

  await t.test('a shared sub-account does not pull a foreign main account along', async () => {
    // Undirected, carl also reached erik via dora — a foreign household.
    // Dragging dora along would give erik's household two currencies: rejected.
    await assert.rejects(
      setUserSetting(ids[4], 'currency', 'CHF'),
      (/** @type {any} */ e) => e.code === 'currency_shared_sub_account' && e.kind === 'conflict',
    );
    assert.deepEqual((await currencies()).slice(4), ['EUR', 'EUR', 'EUR', 'EUR'], 'ein geteiltes Unterkonto …');
    await setUserSetting(ids[6], 'currency', 'EUR');
    assert.deepEqual((await currencies()).slice(4), ['EUR', 'EUR', 'EUR', 'EUR'], 'derselbe Wert geht durch');
    await db.run('DELETE FROM account_links WHERE main_user_id = $1 AND sub_user_id = $2', [ids[6], ids[5]]);
    await setUserSetting(ids[4], 'currency', 'CHF');
    assert.deepEqual(
      (await currencies()).slice(4),
      ['CHF', 'CHF', 'EUR', 'CHF'],
      'nach dem Lösen: carl, dora, cleo; erik bleibt',
    );
  });

  await t.test('at most five changes per hour', async () => {
    // The change above was the first of this account.
    for (const w of ['GBP', 'EUR', 'CHF', 'SEK']) await setUserSetting(ids[3], 'currency', w);
    await assert.rejects(
      setUserSetting(ids[3], 'currency', 'NOK'),
      (/** @type {any} */ e) => e.code === 'too_many_requests' && e.kind === 'too_many',
    );
    await setUserSetting(ids[3], 'currency', 'SEK');
    assert.equal((await currencies())[3], 'SEK', 'ein unveränderter Wert zählt nicht und geht durch');
  });
});
