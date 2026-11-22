/**
 * The condition cascade input → stock → default, executed.
 *
 * ── Counter-checks (carried out, see comment in the commit) ───────────────────
 *   a) `if (bisher) return bisher;` → `if (bisher != null) return bisher;`
 *      (i.e. ?? instead of ||) → “an empty stock condition counts as not
 *      set” turns red. Exactly the seam at which JS falsy and Kotlin null
 *      have already drifted apart several times in this project.
 *   b) the input check loosened to `if (eingabe)` → “an invalid
 *      input does not count” turns red.
 *   c) the order turned around (first stock, then input) → „die Eingabe
 *      gewinnt" turns red.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { conditionForPrice, setGlobalSetting } = _req('src/settings/settings.js');
const { setUserSetting } = _req('src/settings/userSetting.js');

test('condition for the market price: input → stock → default', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  // Own user per process — the test runs next to others on the same DB.
  const name = `zfp_${process.pid}`;
  const created = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [name],
  );
  const uid = created.id;

  const beforeGlobal = await db
    .get(`SELECT value FROM global_settings WHERE key='default_price_condition'`)
    .catch(() => null);

  try {
    // ── The default at the very bottom ─────────────────────────────────────────────
    await setGlobalSetting('default_price_condition', 'U');
    await db.run(`DELETE FROM user_settings WHERE user_id=$1 AND key='user_default_condition'`, [uid]);

    assert.equal(
      await conditionForPrice(undefined, null, uid),
      'U',
      'without input and without stock the global default must apply',
    );

    // ── The stock beats the default ────────────────────────────────────
    assert.equal(
      await conditionForPrice(undefined, 'N', uid),
      'N',
      'stock kept as "Neu" must not fall back to the default — ' +
        'that was exactly the bug from an earlier round, just the other way round',
    );

    // ── The input beats both ──────────────────────────────────────────
    assert.equal(await conditionForPrice('N', 'U', uid), 'N', 'the input wins');
    assert.equal(await conditionForPrice('U', 'N', uid), 'U', 'the input wins');

    // ── An invalid input does not count ──────────────────────────────────
    // The body comes from the client; anything can stand there. An 'X' must not
    // be passed on as a condition, otherwise it lands in the acquisition.
    for (const garbage of ['X', '', 'neu', 0, true, null, {}]) {
      assert.equal(
        await conditionForPrice(garbage, 'U', uid),
        'U',
        `input ${JSON.stringify(garbage)} is not a condition and must be skipped`,
      );
    }

    // ── An empty stock condition counts as not set ──────────────────
    // That is how the form clears the value. With `??` instead of `||` '' would come out here
    // and be passed on as a condition.
    assert.equal(
      await conditionForPrice(undefined, '', uid),
      'U',
      'the empty string is not a condition — it must fall through to the default',
    );

    // ── The user value beats the global default ────────────────────────
    await setUserSetting(uid, 'user_default_condition', 'N');
    assert.equal(
      await conditionForPrice(undefined, null, uid),
      'N',
      "the user's own default must override the global one",
    );
  } finally {
    await db.run(`DELETE FROM user_settings WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    if (beforeGlobal?.value !== undefined)
      await setGlobalSetting('default_price_condition', beforeGlobal.value).catch(() => {});
    else await db.run(`DELETE FROM global_settings WHERE key='default_price_condition'`).catch(() => {});
    // Without this the process never ends: the pool holds open connections, and
    // node:test waits for them. The same line stands at the end of every other
    // DB test here — forgetting it looks like a hanging test.
    await db.pool.end().catch(() => {});
  }
});
