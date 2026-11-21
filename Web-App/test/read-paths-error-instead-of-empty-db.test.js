/**
 * A read error in the catalog goes to the caller instead of looking like „nothing there“:
 * color list, BrickLink mapping, instructions and set detail. The error is forced
 * by the test briefly renaming a table of its own database.
 *
 * Counter-checks (measured on 11.11.2026):
 *   A  src/catalog/colors.ts: loadedColors() again with substitute `.catch(() => [])`
 *      → red: “color list” (the emergency list came instead of an error)
 *   B  src/catalog/blMapping.ts: blNumberOf() again with substitute null
 *      → red: “BrickLink mapping”
 *   C  src/catalog/instructions.ts: instructionsToSet() again with substitute `[]`
 *      → red: “instructions of a set”
 *   D  src/catalog/service.ts: newestInventory() in catalogSet() again with substitute null
 *      → red: „Set-Detail“ (minifigs 0 instead of an error)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { catalogSet: putCatalogSetAn } = require('./helpers/inventory');

const FARBE = 990000 + (process.pid % 9000);
const TEIL = `lpf${process.pid}`;
const SET = `LPF${process.pid}-1`;
const NAME = `lesepfade_${process.pid}`;

test('read error in the catalog: error instead of empty', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const { colorList } = _req('src/catalog/colors.js');
  const { blNumberOf } = _req('src/catalog/blMapping.js');
  const { instructionsToSet } = _req('src/catalog/instructions.js');
  const { catalogSet } = _req('src/catalog/service.js');

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  await db.run(
    `INSERT INTO rb_colors (id, name, rgb) VALUES ($1, 'Probefarbe', 'ABCDEF') ON CONFLICT (id) DO NOTHING`,
    [FARBE],
  );
  await db.run(`INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ('part', $1, $2) ON CONFLICT DO NOTHING`, [
    TEIL,
    `${TEIL}bl`,
  ]);
  await db.run(`INSERT INTO shared_instructions (set_number, url) VALUES ($1, 'https://example.invalid/a.pdf')`, [SET]);
  await putCatalogSetAn(db, SET, { name: 'Probeset' });
  t.after(async () => {
    await db.run('DELETE FROM rb_colors WHERE id = $1', [FARBE]).catch(() => {});
    await db.run('DELETE FROM bl_mapping WHERE rb_id = $1', [TEIL]).catch(() => {});
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [SET]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  /** The table comes back in finally, even if an assertion fails. */
  const ohne = async (tabelle, work) => {
    await db.run(`ALTER TABLE ${tabelle} RENAME TO ${tabelle}_weg`);
    try {
      await work();
    } finally {
      await db.run(`ALTER TABLE IF EXISTS ${tabelle}_weg RENAME TO ${tabelle}`);
    }
  };

  await t.test('color list', async () => {
    assert.ok(
      (await colorList()).some(f => f.id === FARBE),
      'die Probefarbe fehlt — die Prüfung darunter bewiese nichts',
    );
    await ohne('rb_colors', () => assert.rejects(colorList(), /rb_colors/));
  });

  await t.test('BrickLink mapping', async () => {
    assert.equal(await blNumberOf('part', TEIL), `${TEIL}bl`);
    await ohne('bl_mapping', () => assert.rejects(blNumberOf('part', TEIL), /bl_mapping/));
  });

  await t.test('instructions of a set', async () => {
    assert.equal((await instructionsToSet(SET)).length, 1);
    await ohne('shared_instructions', () => assert.rejects(instructionsToSet(SET), /shared_instructions/));
  });

  await t.test('Set-Detail', async () => {
    assert.equal((await catalogSet(uid, SET))?.set_number, SET);
    await ohne('rb_inventories', () => assert.rejects(catalogSet(uid, SET), /rb_inventories/));
  });
});
