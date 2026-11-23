/**
 * A read error does not look like “empty”: either the response carries it
 * in `degradiert`, or it goes on as an error. It is forced by the test
 * briefly renaming a table of its own database.
 *
 * Counter-checks (measured 10.11.2026):
 * - src/parts/queries.ts: market prices again with
 *   `.catch(reportAndDeliver('teile:marktpreise', new Map()))` instead of `ab.oder` → red:
 *   “without prices the list says why” (no `degradiert`).
 * - src/settings/settings.ts: getGlobalSetting again with
 *   `.catch(reportAndDeliver(…, null))` → red: “a setting that cannot be
 *   read is not a default” (delivered '24').
 * - Opposite direction “with prices `degradiert` stays away” was green in both.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { getGlobalSetting } = _req('src/settings/settings.js');

const NAME = `degradiert_${process.pid}`,
  PART = '3001dg';

test('read errors: `degradiert` or an error, never silently empty', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, $2, 5, 'manual')`, [uid, PART]);
  await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity) VALUES ($1, $2, 5, 2)`, [
    uid,
    PART,
  ]);
  // The table comes back in the finally, even if an assertion fails.
  const route = async (/** @type {string} */ table) => {
    await db.run(`ALTER TABLE ${table} RENAME TO ${table}_weg`);
    return () => db.run(`ALTER TABLE IF EXISTS ${table}_weg RENAME TO ${table}`);
  };
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { session: { userId: uid }, t });
  const manualOnes = async () => {
    const r = await fetch(`${base}/api/v2/parts/manual`);
    assert.equal(r.status, 200);
    return r.json();
  };

  await t.test('with prices `degradiert` stays away', async () => {
    const j = await manualOnes();
    assert.deepEqual(
      j.parts.map((/** @type {any} */ p) => p.part_number),
      [PART],
    );
    assert.equal(j.degraded, undefined);
  });

  await t.test('without prices the list says why', async () => {
    const back = await route('part_price_cache');
    try {
      const j = await manualOnes();
      assert.deepEqual(
        j.parts.map((/** @type {any} */ p) => p.part_number),
        [PART],
        'the list stays',
      );
      assert.equal(j.parts[0].avg_price, null);
      assert.deepEqual(j.degraded, ['marktpreise']);
    } finally {
      await back();
    }
  });

  await t.test('a setting that cannot be read is not a default', async () => {
    assert.equal(
      await getGlobalSetting(`fehlt_${process.pid}`, '24'),
      '24',
      'Precondition: default for „nicht gesetzt“',
    );
    const back = await route('global_settings');
    try {
      await assert.rejects(getGlobalSetting('price_cache_ttl', '24'), (/** @type {any} */ e) => e.code === '42P01');
    } finally {
      await back();
    }
  });
});
