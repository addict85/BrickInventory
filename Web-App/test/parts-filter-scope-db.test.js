/**
 * Color filter and category filter count the same scope.
 *
 * Counter-check: in routes/api/parts.ts the colour list only for the own account → red “color and category list see the same inventory in the household”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('color and category list see the same inventory in the household', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const mainName = `tfhaupt-${process.pid}`,
    kindName = `tfkind-${process.pid}`;
  for (const n of [mainName, kindName]) await db.run('DELETE FROM users WHERE username = $1', [n]).catch(() => {});
  const haupt = (
    await db.get('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [mainName, 'x'])
  ).id;
  const kind = (
    await db.get('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [kindName, 'x'])
  ).id;

  try {
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [haupt, kind]);

    // The set carries the parts — both lists exclude `source='manual'`.
    await holdsSet(db, haupt, '0001-1', 1);
    await holdsSet(db, kind, '0002-1', 1);
    // One part per account, DIFFERENT colors: if the color were the same, both
    // counts would find the same number by chance and the test would check nothing.
    // Since migration 0034 name, color label and category stand in the
    // catalogs — and here they are the core of the matter: both lists of this …
    await db.run(`INSERT INTO part_catalog (part_number, part_name, category_name) VALUES
        ('3001','Brick 2x4','Bricks'), ('3002','Plate 1x2','Plates')
        ON CONFLICT (part_number) DO UPDATE SET category_name = EXCLUDED.category_name`);
    await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
        ('3001',4,'Red'), ('3002',1,'Blue')
        ON CONFLICT (part_number, color_id) DO UPDATE SET color_name = EXCLUDED.color_name`);
    await holdsPart(db, haupt, '3001', { setNumber: '0001-1', quantity: 2, colorId: 4 });
    await holdsPart(db, kind, '3002', { setNumber: '0002-1', quantity: 5, colorId: 1 });

    const { base } = testServer(_req, { sitzung: { userId: haupt }, t });
    const hole = async path => (await fetch(base + path)).json();

    for (const modus of ['all', 'own']) {
      const farben = await hole(`/api/v2/parts/colors?accounts=${modus}`);
      const kats = await hole(`/api/v2/parts/categories?accounts=${modus}`);
      assert.ok(farben.success, `colours (${modus}): ${JSON.stringify(farben)}`);
      assert.ok(kats.success, `categories (${modus}): ${JSON.stringify(kats)}`);

      const summe = (l, f) => l.reduce((a, x) => a + Number(x[f] || 0), 0);
      assert.equal(
        summe(kats.categories, 'unique_parts'),
        summe(farben.colors, 'unique_parts'),
        `${modus}: colour and category lists count different numbers of parts — ` +
          `they then read different scopes.\n` +
          `colours: ${JSON.stringify(farben.colors)}\n` +
          `categories: ${JSON.stringify(kats.categories)}`,
      );
    }

    // And the difference between the modes must be there at all — otherwise
    // the equality above would be the same statement twice.
    const alle = await hole('/api/v2/parts/categories?accounts=all');
    const eigen = await hole('/api/v2/parts/categories?accounts=own');
    assert.ok(
      alle.categories.length > eigen.categories.length,
      'With the household there must be more categories than without — otherwise ' +
        '`accounts` has no effect and the comparison above is worthless',
    );
  } finally {
    await db.run('DELETE FROM parts WHERE user_id = ANY($1)', [[haupt, kind]]).catch(() => {});
    await db.run('DELETE FROM sets WHERE user_id = ANY($1)', [[haupt, kind]]).catch(() => {});
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [haupt]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[haupt, kind]]).catch(() => {});
  }
});
