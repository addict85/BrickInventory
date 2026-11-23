/**
 * Lock namespaces against a REAL database.
 *
 * Counter-check (measured on 27.10.): txLock again with the user_id as the first
 * value → red: “an account's inventory lock does not hit a job”. Since the lock
 * is an option of k.transact (14.11.2026) again: in lockInventories()
 * (src/infra/area.ts) the account ID as class → red, the same test.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip (unless
 * REQUIRE_DB=1).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testContext } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { LOCKS } = _req('src/infra/lockNamespaces.js');

async function dbReachable() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test('lock namespaces against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }

  /** Hold a lock on an own connection (not from the pool: there are more
   * namespaces than pool slots); returns the releaser. */
  async function hold(ns, secondOne = 0) {
    const c = await db.ownConnection();
    const { rows } = await c.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [ns, secondOne]);
    if (!rows[0].ok) {
      await c.end();
      throw new Error(`Namespace ${ns} was already taken`);
    }
    return () => c.end();
  }

  /** Does a SECOND connection still get this lock? */
  async function stillFree(ns, secondOne = 0) {
    const c = await db.pool.connect();
    try {
      const { rows } = await c.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [ns, secondOne]);
      if (rows[0].ok) await c.query('SELECT pg_advisory_unlock($1, $2)', [ns, secondOne]);
      return rows[0].ok;
    } finally {
      c.release();
    }
  }

  await t.test('all namespaces are pairwise different', () => {
    const entries = Object.entries(LOCKS);
    assert.ok(entries.length >= 8, `Only ${entries.length} namespaces found — is LOCKS still the complete list?`);

    const seen = new Map();
    for (const [name, num] of entries) {
      assert.equal(typeof num, 'number', `${name} is not a number`);
      // Advisory locks are 64-bit; the single-value form takes bigint, the
      // two-value one two int4. All entries here are used with two values OR
      // one value — int4 is the narrower limit and therefore applies.
      assert.ok(
        Number.isInteger(num) && num > 0 && num <= 2147483647,
        `${name} = ${num} does not fit into an int4 namespace`,
      );
      if (seen.has(num)) {
        assert.fail(
          `${name} and ${seen.get(num)} share the namespace ${num} — ` + 'the two operations lock each other out',
        );
      }
      seen.set(num, name);
    }
  });

  await t.test('different namespaces do not hinder each other', async () => {
    // The actual point: hold ALL at the same time. If there were a
    // duplicate anywhere, already the acquiring would fail — and with the name included.
    const release = [];
    try {
      for (const [name, num] of Object.entries(LOCKS)) {
        try {
          release.push(await hold(num));
        } catch (e) {
          assert.fail(`${name} (${num}) could not be claimed: ${e.message}`);
        }
      }
      assert.equal(release.length, Object.keys(LOCKS).length);
    } finally {
      for (const f of release) await f();
    }
  });

  await t.test('the same namespace really locks out', async () => {
    // Counter-check to the previous check: if pg_try_advisory_lock were always
    // successful here, „all acquirable at once" would say nothing at all.
    const free = await hold(LOCKS.PRICE_JOB);
    try {
      assert.equal(
        await stillFree(LOCKS.PRICE_JOB),
        false,
        'A second connection got the same lock — then it protects nothing',
      );
    } finally {
      await free();
    }
    assert.equal(await stillFree(LOCKS.PRICE_JOB), true, 'After releasing, the lock must be available again');
  });

  await t.test('the second value subdivides the namespace', async () => {
    // Image download and CSV import rely on it: the same number, but
    // an own key per set or per table. Without this subdivision
    // they would run one after another instead of side by side.
    const free = await hold(LOCKS.IMAGE_DOWNLOAD, 111);
    try {
      assert.equal(
        await stillFree(LOCKS.IMAGE_DOWNLOAD, 222),
        true,
        'Two different sets must be allowed to load in parallel',
      );
      assert.equal(
        await stillFree(LOCKS.IMAGE_DOWNLOAD, 111),
        false,
        'The same set must NOT load twice at the same time',
      );
    } finally {
      await free();
    }
  });

  await t.test("an account's inventory lock does not hit a job", async () => {
    // Account ID = number of a job, key = set number: with the user_id as the
    // first value this was exactly the lock of the image download for this set.
    const SET = '60511-1';
    const secondOne = (await db.get('SELECT hashtext($1) AS h', [SET])).h;
    const free = {};
    await testContext('inventory').transact(
      async () => {
        free.image = await stillFree(LOCKS.IMAGE_DOWNLOAD, secondOne);
        // On an own connection: db.get would run here via the transaction that already holds the lock.
        free.itself = await stillFree(
          LOCKS.INVENTORY,
          (await db.pool.query('SELECT hashtext($1) AS h', [`${LOCKS.IMAGE_DOWNLOAD}|${SET}`])).rows[0].h,
        );
      },
      { locks: [{ account: LOCKS.IMAGE_DOWNLOAD, key: SET }] },
    );
    assert.equal(free.image, true, 'The stock lock of account 42 holds up the image download of the set');
    assert.equal(
      free.itself,
      false,
      'The stock lock is not under LOCKS.INVENTORY — then the case above checks nothing',
    );
  });

  await t.test('no bare number in a lock call any more', () => {
    // The only source text check that stays here — and it does not check
    // WHICH number stands somewhere, but THAT none stands there directly any more.
    // Exactly that makes the list above the only truth: a call with
    // a typed-in number would bypass it.
    const fs = require('node:fs');
    const path = require('node:path');
    const { ROOT } = require('./helpers/sources');

    const files = [];
    (function collect(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git', 'data', 'test'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collect(p);
        else if (e.name.endsWith('.ts')) files.push(p);
      }
    })(ROOT);

    const hits = [];
    let checked = 0;
    for (const p of files) {
      if (p.endsWith(path.join('src/infra/lockNamespaces.ts'))) continue; // the list itself
      for (const row of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!/pg_(try_)?advisory(_xact)?(_)?lock|pg_advisory_unlock/.test(row)) continue;
        if (/^\s*[*/]/.test(row)) continue; // comment
        checked++;
        if (/advisory[a-z_]*\(\s*\d/.test(row)) {
          hits.push(`${path.relative(ROOT, p)}: ${row.trim().slice(0, 90)}`);
        }
      }
    }
    assert.ok(checked >= 10, `Only ${checked} lock calls found — does the search pattern still match?`);
    assert.deepEqual(
      hits,
      [],
      `Lock namespace as a typed-in number instead of from src/infra/lockNamespaces.ts:\n  ${hits.join('\n  ')}`,
    );
  });

  await db.pool.end().catch(() => {});
});
