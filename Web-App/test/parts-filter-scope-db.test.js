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
  const main = (
    await db.get('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [mainName, 'x'])
  ).id;
  const kind = (
    await db.get('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [kindName, 'x'])
  ).id;

  try {
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [main, kind]);

    // The set carries the parts — both lists exclude `source='manual'`.
    await holdsSet(db, main, '0001-1', 1);
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
    await holdsPart(db, main, '3001', { setNumber: '0001-1', quantity: 2, colorId: 4 });
    await holdsPart(db, kind, '3002', { setNumber: '0002-1', quantity: 5, colorId: 1 });

    const { base } = testServer(_req, { session: { userId: main }, t });
    const hole = async path => (await fetch(base + path)).json();

    for (const mode of ['all', 'own']) {
      const colors = await hole(`/api/v2/parts/colors?accounts=${mode}`);
      const kats = await hole(`/api/v2/parts/categories?accounts=${mode}`);
      assert.ok(colors.success, `colours (${mode}): ${JSON.stringify(colors)}`);
      assert.ok(kats.success, `categories (${mode}): ${JSON.stringify(kats)}`);

      const sum = (l, f) => l.reduce((a, x) => a + Number(x[f] || 0), 0);
      assert.equal(
        sum(kats.categories, 'unique_parts'),
        sum(colors.colors, 'unique_parts'),
        `${mode}: colour and category lists count different numbers of parts — ` +
          `they then read different scopes.\n` +
          `colours: ${JSON.stringify(colors.colors)}\n` +
          `categories: ${JSON.stringify(kats.categories)}`,
      );
    }

    // And the difference between the modes must be there at all — otherwise
    // the equality above would be the same statement twice.
    const all = await hole('/api/v2/parts/categories?accounts=all');
    const own = await hole('/api/v2/parts/categories?accounts=own');
    assert.ok(
      all.categories.length > own.categories.length,
      'With the household there must be more categories than without — otherwise ' +
        '`accounts` has no effect and the comparison above is worthless',
    );
  } finally {
    await db.run('DELETE FROM parts WHERE user_id = ANY($1)', [[main, kind]]).catch(() => {});
    await db.run('DELETE FROM sets WHERE user_id = ANY($1)', [[main, kind]]).catch(() => {});
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [main]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[main, kind]]).catch(() => {});
  }
});
