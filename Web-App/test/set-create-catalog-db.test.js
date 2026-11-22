/**
 * A placeholder name never overwrites the real name of a set, and an
 * input that cannot be a set number is not created.
 *
 * Error picture: „Titanic" was called „Set 10294-1" after capturing again. The
 * BrickLink type check creates a catalog_cache row; setAngaben() must still name the
 * name from the catalog (rb_sets).
 *
 * Counter-checks (A measured on 11.11.2026, B and C on 28.10.2026):
 *   A  in catalogSetTo() `rs.name` replaced by `NULL::text AS name` → red:
 *      “setAngaben names the catalog name, not a placeholder”
 *   B  when creating (back then addSetIntern) again `name = EXCLUDED.name` → red: “adding
 *      again without sources leaves the catalog name alone”
 *   C  the check possibleSetNumber() removed when creating → red:
 *      “an input without a digit is not created as a set” ("abc-1" in the inventory)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without API keys, so that
 * no source answers.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('catalog name stays when sources are missing', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  const SN = `9${process.pid % 10000}-1`;
  const NAME = `kat-name-${process.pid}`;
  const schluessel = ['rebrickable_api_key', 'brickset_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await catalogSet(db, SN, { name: 'Titanic', year: 2021 });
  await db.run(
    `INSERT INTO catalog_cache (set_number, bl_type, is_gear) VALUES ($1, 'NONE', false)
                ON CONFLICT (set_number) DO UPDATE SET fetched_at=NOW()`,
    [SN],
  );

  try {
    await t.test('setAngaben names the catalog name, not a placeholder', async () => {
      // Since 0108 the fetch state in catalog_cache carries no name that could cover the catalog.
      const info = await _req('src/catalog/rebrickableCatalog.js').setDetails(SN);
      assert.equal(info?.name, 'Titanic');
    });

    await t.test('adding again without sources leaves the catalog name alone', async () => {
      const r = await require('./helpers/sources').areaPage('sets').acquireSet({
        requester: uid,
        setNumber: SN,
        quantity: 1,
        kaufpreis: 10,
        condition: 'N',
      });
      assert.equal(r.action, 'added');
      const kat = await db.get('SELECT name, year FROM rb_sets WHERE set_num=$1', [SN]);
      assert.equal(kat.name, 'Titanic');
      assert.equal(kat.year, 2021);
    });

    await t.test('an input without a digit is not created as a set', async () => {
      const { acquireSet } = require('./helpers/sources').areaPage('sets');
      await assert.rejects(
        acquireSet({ requester: uid, setNumber: 'abc', quantity: 1, condition: 'N', ifPresent: 'aufstocken' }),
        (/** @type {any} */ e) => e.kind === 'ungueltig' && e.code === 'set_number_invalid',
      );
      assert.equal(await db.get(`SELECT 1 FROM sets WHERE user_id=$1 AND set_number='abc-1'`, [uid]), undefined);
      const { possibleSetNumber } = _req('src/infra/setNumber.js');
      for (const gut of ['10294-1', '928-1', 'comcon001-1', 'llca37-1', '5005358-2'])
        assert.ok(possibleSetNumber(gut), gut);
      for (const badOne of ['abc-1', '-1', 'x'.repeat(21) + '1-1', '10294'])
        assert.ok(!possibleSetNumber(badOne), badOne);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.run('DELETE FROM rb_sets WHERE set_num=$1', [SN]);
    await db.run('DELETE FROM catalog_cache WHERE set_number=$1', [SN]);
    for (const { key, value } of vorher)
      await db.run('INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [
        key,
        value,
      ]);
    await db.pool.end().catch(() => {});
  }
});
