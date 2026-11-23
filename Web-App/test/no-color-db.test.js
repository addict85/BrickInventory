/**
 * „No color“ is 9999 as at Rebrickable, 0 stays black (migration
 * 0071, src/catalog/colors.ts). Checked are the migration on legacy data, the
 * capture without color, the color list without Rebrickable and the price fetch.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in 0071 rule 2 the condition farbname_von = user_id removed → red:
 *      „ein fremder Name beweist nichts“ (B's black became 9999)
 *   B  V.colorId() again returns 0 for empty → red: “a part without color
 *      does not turn black”
 *   C  the old emergency list (13 = Black) back in farben.ts → red: „die
 *      Notliste führt nur echte Rebrickable-IDs“
 *   D  resolveBlColorId without the branch for KEINE_FARBE → red: “no color
 *      asks BrickLink for (Not Applicable)”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const MIGRATION = path.join(__dirname, '..', 'db/migrations/0071-keine-farbe.sql');

test('no color is 9999, 0 stays black', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('the migration only converts where the row proves it', async () => {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      // State before 0071: color_id may be NULL, the index folds NULL to 0.
      await c.query(`ALTER TABLE parts ALTER COLUMN color_id DROP NOT NULL;
                     DROP INDEX idx_parts_unique;
                     CREATE UNIQUE INDEX idx_parts_unique ON parts (user_id, COALESCE(set_number, ''), part_number, COALESCE(color_id, 0))`);
      // The origin columns until migration 0093.
      await c.query('ALTER TABLE part_color_catalog ADD COLUMN farbname_von integer, ADD COLUMN farbcode_von integer');
      const account = async n =>
        (
          await c.query(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [
            `farbe-${n}-${process.pid}`,
          ])
        ).rows[0].id;
      const A = await account('a'),
        B = await account('b');
      await c.query(`INSERT INTO rb_colors (id,name,rgb) VALUES (0,'Black','05131D'),(13,'Pink','FC97AC')
                     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);
      await c.query(`INSERT INTO sets (user_id, set_number) VALUES ($1, 'F1-1')`, [A]);
      const part = (u, nr, color, record = null) =>
        c.query(`INSERT INTO parts (user_id, set_number, part_number, color_id, source) VALUES ($1,$2,$3,$4,$5)`, [
          u,
          record,
          nr,
          color,
          record ? 'set' : 'manual',
        ]);
      const purchase = (u, nr, color, quantity, tag = '2026-01-05') =>
        c.query(
          `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency, created_at)
         VALUES ($1,$2,$3,$4,1.5,'N','CHF',$5)`,
          [u, nr, color, quantity, `${tag}T12:00:00Z`],
        );
      const catalog = (nr, color, name, hex, from) =>
        c.query(
          `INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, farbname_von, farbcode_von)
         VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (part_number, color_id) DO UPDATE
         SET color_name = EXCLUDED.color_name, color_hex = EXCLUDED.color_hex,
             farbname_von = EXCLUDED.farbname_von, farbcode_von = EXCLUDED.farbcode_von`,
          [nr, color, name, hex, from],
        );

      await part(A, 'KF1', null);
      await purchase(A, 'KF1', 0, 2); // rule 1
      await part(A, 'KF2', 0);
      await purchase(A, 'KF2', 0, 1); // rule 2
      await catalog('KF2', 0, '[No Color/Any Color]', 'FCFCFC', A);
      await part(B, 'KF2', 0);
      await purchase(B, 'KF2', 0, 4); // foreign name
      await part(A, 'KF3', 0);
      await catalog('KF3', 0, 'Black', '05131D', null); // real black
      await part(A, 'KF4', 13);
      await purchase(A, 'KF4', 13, 3); // rule 3
      await catalog('KF4', 13, 'Black', '05131D', A);
      await part(A, 'KF5', null);
      await purchase(A, 'KF5', 0, 2); // merge
      await part(A, 'KF5', 9999);
      await purchase(A, 'KF5', 9999, 5);
      await part(A, 'KF6', 0, 'F1-1'); // Set-Teil

      // Check the deferred foreign keys of the test rows, otherwise
      // ALTER TABLE refuses in the same transaction.
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      // Migration 0071 is history and still names the column by its
      // old name (part_acquisitions.tag); 0124 (applied long ago) would otherwise have
      // renamed it right afterwards, as with a real order of the migrations.
      // The trigger (migration 0070/0124) only knows the respective current column;
      // so switch it off during the renaming, otherwise it fails on NEW.day or NEW.tag.
      await c.query('ALTER TABLE part_acquisitions DISABLE TRIGGER part_acquisitions_day');
      await c.query('ALTER TABLE part_acquisitions RENAME COLUMN day TO tag');
      await c.query(fs.readFileSync(MIGRATION, 'utf8'));
      await c.query('ALTER TABLE part_acquisitions RENAME COLUMN tag TO day');
      await c.query('ALTER TABLE part_acquisitions ENABLE TRIGGER part_acquisitions_day');

      const colors = async (u, nr) =>
        (
          await c.query(
            `SELECT p.color_id AS f, (SELECT COALESCE(json_agg(json_build_array(a.color_id, a.quantity) ORDER BY a.color_id), '[]')
                                    FROM part_acquisitions a WHERE a.user_id = p.user_id AND a.part_number = p.part_number) AS k
           FROM parts p WHERE p.user_id = $1 AND p.part_number = $2 ORDER BY p.color_id`,
            [u, nr],
          )
        ).rows;
      assert.deepEqual(
        await colors(A, 'KF1'),
        [{ f: 9999, k: [[9999, 2]] }],
        'NULL becomes 9999 including acquisitions',
      );
      assert.deepEqual(await colors(A, 'KF2'), [{ f: 9999, k: [[9999, 1]] }], 'a self-chosen [No Color] becomes 9999');
      assert.deepEqual(await colors(B, 'KF2'), [{ f: 0, k: [[0, 4]] }], 'a foreign name proves nothing');
      assert.deepEqual(await colors(A, 'KF3'), [{ f: 0, k: [] }], 'black stays black');
      assert.deepEqual(await colors(A, 'KF4'), [{ f: 0, k: [[0, 3]] }], 'Notlisten-Black (13) zieht auf 0');
      assert.deepEqual(await colors(A, 'KF5'), [{ f: 9999, k: [[9999, 7]] }], 'identical acquisitions are added up');
      assert.deepEqual(await colors(A, 'KF6'), [{ f: 0, k: [] }], 'Set-Teile bleiben');
      const column = (
        await c.query(`SELECT is_nullable, column_default FROM information_schema.columns
                                      WHERE table_name = 'parts' AND column_name = 'color_id'`)
      ).rows[0];
      assert.deepEqual(column, { is_nullable: 'NO', column_default: '9999' });
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  await t.test('a part without color does not turn black', async () => {
    const V = _req('src/infra/validate.js');
    assert.equal(V.colorId(''), 9999);
    assert.equal(V.colorId(null), 9999);
    assert.equal(V.colorId('-1'), 9999);
    assert.equal(V.colorId('0'), 0);
    assert.equal(V.colorId(4), 4);
    const NAME = `farbe-erfassen-${process.pid}`;
    await db.run('DELETE FROM users WHERE username=$1', [NAME]);
    const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
    try {
      const { addManualPart } = _req('src/parts/manualParts.js');
      await addManualPart(uid, {
        part_number: 'KF9',
        part_name: 'Probe',
        color_id: null,
        quantity: 2,
        unit_price: 1,
      });
      await addManualPart(uid, {
        part_number: 'KF9',
        part_name: 'Probe',
        color_id: 0,
        quantity: 1,
        unit_price: 1,
      });
      const lines = await db.all(
        `SELECT p.color_id, SUM(a.quantity)::int AS quantity FROM parts p
        JOIN part_acquisitions a ON a.user_id = p.user_id AND a.part_number = p.part_number AND a.color_id = p.color_id
        WHERE p.user_id = $1 GROUP BY p.color_id ORDER BY p.color_id`,
        [uid],
      );
      assert.deepEqual(lines, [
        { color_id: 0, quantity: 1 },
        { color_id: 9999, quantity: 2 },
      ]);
    } finally {
      await db.run('DELETE FROM users WHERE id=$1', [uid]);
    }
  });

  await t.test(
    'the color list comes from rb_colors, the emergency list only carries real Rebrickable IDs',
    async () => {
      const { colorList } = _req('src/catalog/colors.js');
      const prior = await db.all('SELECT id, name, rgb FROM rb_colors');
      try {
        await db.run('DELETE FROM rb_colors');
        const not = await colorList(); // no key, no fetch
        assert.equal(not.find(f => f.id === 0)?.name, 'Black');
        assert.equal(not.find(f => f.id === 9999)?.name, '[No Color/Any Color]');
        assert.ok(!not.some(f => f.id === 13), 'the fallback list holds only real Rebrickable IDs');
        await db.run(
          `INSERT INTO rb_colors (id,name,rgb) VALUES (0,'Black','05131D'),(13,'Pink','FC97AC'),(-1,'[Unknown]','0033B2')`,
        );
        assert.deepEqual(await colorList(), [
          { id: 0, name: 'Black', hex: '05131D' },
          { id: 13, name: 'Pink', hex: 'FC97AC' },
        ]);
      } finally {
        await db.run('DELETE FROM rb_colors');
        for (const z of prior)
          await db.run('INSERT INTO rb_colors (id,name,rgb) VALUES ($1,$2,$3)', [z.id, z.name, z.rgb]);
      }
    },
  );

  await t.test('no color asks BrickLink for (Not Applicable)', async () => {
    const { resolveBlColorId } = _req('src/finances/calculation/prices.js');
    assert.equal(await resolveBlColorId(9999), 0);
  });
});
