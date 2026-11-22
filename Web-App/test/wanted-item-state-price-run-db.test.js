/**
 * Which condition does the price run fetch for a wishlist item?
 *
 * ── Counter-checks (performed, result in the commit) ─────────────────────────
 *   a) The wanted query removed from statesJeSet() → red in line 68,
 *      „der Merkposten desselben Sets bei einem anderen Nutzer als gebraucht".
 *      NOT in the line before: without a wishlist the function falls back to
 *      'N' here, and the first wishlist item happens to be 'N' too. That is why
 *      the same wishlist item appears twice, once per condition — the statement
 *      "user-dependent" is only checked with both users.
 *   b) `for (const c of gewuenscht...)` only in the else branch → „Bestand und
 *      Merkposten in verschiedenen Zuständen ergeben beide" turns red.
 *   c) The acquisitions placed behind the holdings → "the acquisitions beat
 *      the sets row" turns red.
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
const { holdsSet } = require('./helpers/inventory');
const db = testData();
const { statesJeSet, conditionsNeededFor } = _req('src/finances/priceRun.js');

/** Compare sorted: the order within the set is not a statement. */
const sortedList = a => [...a].sort();

test('price run: the condition of a wishlist item is that of the user', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  // Own users per process — the test runs alongside others on the same DB.
  const anlegen = async suffix =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
        [`wzp_${process.pid}_${suffix}`],
      )
    ).id;
  const a = await anlegen('a');
  const b = await anlegen('b');

  try {
    // ── Two users, the SAME set, different wishlist items ─────────────────────
    // This is the question in one line: the price run fetches the new price for a
    // and the used price for b — not the same one for both.
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'10305-1','N')`, [a]);
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'10305-1','U')`, [b]);

    assert.deepEqual(
      (await statesJeSet(a, ['10305-1'])).get('10305-1'),
      ['N'],
      'a wanted item for a NEW set must be fetched as new — before, the ' +
        'default DEFAULT_PRICE_CONDITION silently yielded a "U" here',
    );
    assert.deepEqual(
      (await statesJeSet(b, ['10305-1'])).get('10305-1'),
      ['U'],
      'and the wanted item for the same set at another user as used',
    );

    // ── Both conditions wanted: both prices are needed ──────────────────────
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'21318-1','N'),($1,'21318-1','U')`, [
      a,
    ]);
    assert.deepEqual(
      sortedList((await statesJeSet(a, ['21318-1'])).get('21318-1')),
      ['N', 'U'],
      'new and used are two wanted items — the detail needs a price for both',
    );

    // Holding without a wishlist item: the condition comes from the acquisition
    await holdsSet(db, a, '75192-1', 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1,'75192-1',1,'U')`,
      [a],
    );
    assert.deepEqual(
      (await statesJeSet(a, ['75192-1'])).get('75192-1'),
      ['U'],
      'the condition of the acquisition of an own set decides',
    );

    // ── Holding AND wishlist item in the other condition: both ────────────────
    // Whoever owns a set new and looks for a used second one waits for the
    // used price. The valuation needs the new price anyway.
    await holdsSet(db, a, '42100-1', 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1,'42100-1',1,'N')`,
      [a],
    );
    await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,'42100-1','U')`, [a]);
    assert.deepEqual(
      sortedList((await statesJeSet(a, ['42100-1'])).get('42100-1')),
      ['N', 'U'],
      'stock and wanted item in different conditions yield both fetches',
    );

    // ── The condition comes from the acquisition ────────────────────────────
    //
    // Previously this sub-step was called "the acquisitions beat the
    // sets row": sets said 'N', the acquisition 'U', result 'U'. With
    // migration 0032 this contradiction can no longer exist — there is only
    // the acquisition. The statement remains: it decides.
    await holdsSet(db, a, '10276-1', 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, condition) VALUES ($1,'10276-1',1,'U')`,
      [a],
    );
    assert.deepEqual(
      (await statesJeSet(a, ['10276-1'])).get('10276-1'),
      ['U'],
      'the acquisition decides the price to fetch',
    );

    // ── And a set row WITHOUT an acquisition falls back to 'N' ──────────────
    //
    // This case should no longer exist after migration 0032 (it
    // backfilled and checked); here it is produced by hand. What matters
    // is that 'N' comes out and not an EMPTY list — otherwise no price
    // at all would be fetched for this set, and nobody would notice.
    await holdsSet(db, a, '31203-1', 1);
    assert.deepEqual(
      (await statesJeSet(a, ['31203-1'])).get('31203-1'),
      ['N'],
      'without an acquisition it stays at the new price — an empty list would mean ' +
        'that no price at all is fetched for this set',
    );

    // ── A set this user keeps nowhere ───────────────────────────────────────
    assert.deepEqual(
      (await statesJeSet(b, ['75192-1'])).get('75192-1'),
      ['N'],
      'what this user neither owns nor wants falls back to "neu"',
    );

    // ── Bundled and single are the SAME rule ────────────────────────────────
    // They used to exist as two versions, and only one knew the
    // wishlist. This assertion holds them together.
    for (const sn of ['10305-1', '21318-1', '75192-1', '42100-1', '10276-1', '31203-1']) {
      assert.deepEqual(
        sortedList(await conditionsNeededFor(sn, a)),
        sortedList((await statesJeSet(a, [sn])).get(sn)),
        `conditionsNeededFor(${sn}) must say the same as the run`,
      );
    }

    // ── The hint (acquisition that does not exist yet) ──────────────────────
    assert.deepEqual(
      sortedList(await conditionsNeededFor('99999-1', a, 'U')),
      ['U'],
      'without stock the hint decides — otherwise a set recorded ' +
        'as used would get the new price as purchase price',
    );
    assert.deepEqual(
      sortedList(await conditionsNeededFor('10276-1', a, 'N')),
      ['N', 'U'],
      'the hint joins the existing acquisitions, it does not replace them',
    );

    // ── An empty list does not query ────────────────────────────────────────
    assert.equal(
      (await statesJeSet(a, [])).size,
      0,
      'without sets no query may run — the run calls this for every user',
    );
  } finally {
    for (const uid of [a, b]) {
      await db.run(`DELETE FROM wanted WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
      await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    }
    // Without this the process never ends: the pool holds open connections, and
    // node:test waits for them.
    await db.pool.end().catch(() => {});
  }
});
