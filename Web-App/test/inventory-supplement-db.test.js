/**
 * A Rebrickable inventory is searched for by the same candidates everywhere.
 *
 * Counter-checks (performed): see below at the respective substep.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { newestInventory } = _req('src/catalog/rbInventory.js');

test('an inventory is found under both spellings', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  // rb_inventories.id is not a SERIAL — the numbers come from the CSV.
  const idBlank = 900000 + (process.pid % 10000) * 2;
  const idWithV = idBlank + 1;
  const NR = `${9000000 + (process.pid % 100000)}`;
  const cleanUp = () => db.run('DELETE FROM rb_inventories WHERE id = ANY($1)', [[idBlank, idWithV]]).catch(() => {});
  await cleanUp();

  try {
    // 1. Written BLANK: the database stores the number with a suffix.
    //    Counter-check (30.10.2026): trigger rb_inventories_set_number removed
    //    → red (“is stored with a version suffix”: 9xxxxxx instead of 9xxxxxx-1).
    await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1,$2,1)', [idBlank, NR]);
    assert.equal(
      (await db.get('SELECT set_num FROM rb_inventories WHERE id = $1', [idBlank])).set_num,
      `${NR}-1`,
      'A number written bare is stored with a version suffix',
    );
    assert.equal(await newestInventory(NR), idBlank, 'A row stored under the bare number is not found');
    assert.equal(
      await newestInventory(`${NR}-1`),
      idBlank,
      'Even with a version suffix in the input the bare row must be found',
    );

    // 2. If both are present, the highest version wins — not the blank one.
    await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1,$2,2)', [idWithV, `${NR}-1`]);
    assert.equal(await newestInventory(NR), idWithV);
  } finally {
    await cleanUp();
    await db.pool.end();
  }
});

test('the inventory lookup lives in only one place', () => {
  // Found, not enumerated.
  const files = [];
  const go = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (
        e.name === 'node_modules' ||
        e.name === 'dist' ||
        e.name === 'test' ||
        e.name === 'scripts' ||
        e.name.startsWith('.')
      )
        continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) go(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(abs);
    }
  };
  go(ROOT);
  // Self-proof: if the search found nothing, the rule would be vacuously true.
  assert.ok(files.length >= 40, `Only ${files.length} source files found — the search no longer matches`);

  const placeList = [];
  for (const f of files) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    // Only the lookup of ONE row. The bulk query in
    // partsCatalogEnrich (WHERE set_num = ANY(...), without LIMIT) answers
    // a different question and stays where it is.
    for (const m of code.matchAll(/FROM rb_inventories[\s\S]{0,200}?LIMIT 1/g))
      placeList.push(path.relative(ROOT, f) + (m ? '' : ''));
  }
  // Counter-check: the old SELECT in routes/api/catalog.ts reinserted
  // → red.
  assert.deepEqual(
    placeList,
    ['src/catalog/repository/catalogMaster.ts'],
    'The inventory lookup is in more than one place — that is exactly how ' +
      'four different candidate rules came about',
  );
});
