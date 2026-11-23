/**
 * When topping up a set, price and noted condition must match TOGETHER.
 *
 * Counter-check: userDefaultCondition() (src/settings/settings.ts) ignores a stored 'U' → red “topping up without a condition follows the user's default”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();
const { setUserSetting } = _req('src/settings/userSetting.js');
const { acquireSet } = require('./helpers/sources').areaPage('sets');

test("topping up without a condition follows the user's default", { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const name = `zst_${process.pid}`;
  const SET = `90${String(process.pid).slice(-4)}-1`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    [name],
  );
  const uid = u.id;

  try {
    // The user collects used.
    await setUserSetting(uid, 'user_default_condition', 'U');

    // ISOLATE the top-up path
    await holdsSet(db, uid, SET, 1, { condition: 'N' });

    // Acquisition WITHOUT a condition. Pass the price along so that no network call
    // is needed; this is not about the price.
    await acquireSet({ requester: uid, setNumber: SET, quantity: 1, kaufpreis: 20, ifPresent: 'aufstocken' });

    const zeilen = await db.all(
      `SELECT id, quantity, condition FROM set_acquisitions
        WHERE user_id=$1 AND set_number=$2 ORDER BY id`,
      [uid, SET],
    );
    assert.equal(
      zeilen.length,
      2,
      `${zeilen.length} acquisition(s): ${JSON.stringify(zeilen)}. Expected are ` +
        'TWO — the precondition with "N" and the one of the top-up path with the ' +
        'default "U". A single one would mean that the two conditions are ' +
        'merged again.',
    );
    assert.equal(zeilen[0].condition, 'N', "precondition: the helper's row");

    const neue = zeilen[1];
    assert.equal(
      neue.condition,
      'U',
      `The acquisition of the top-up path is stored as "${neue.condition}" in the ` +
        'database, although the user\'s default is "U" and the price was fetched exactly ' +
        'for that. Price and note must mean the same condition — ' +
        'otherwise the entry counts in the wrong group in the finance view.',
    );
  } finally {
    await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM user_settings WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
