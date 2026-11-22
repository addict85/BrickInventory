/**
 * Shortening a quantity means deleting or shortening several entries.
 * If one step fails, everything stays as it was — previously only
 * some entries were then gone, and the quantity no longer matched.
 *
 * The error is forced with a trigger on the older entry.
 *
 * Counter-check (measured on 27.10.): in changeManualPart the loop again
 * without db.transaction (db.run instead of tx.run) → red: “nothing half shortened"
 * (the newer entry was deleted).
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
const db = testData();
const { changeManualPart } = _req('src/parts/manualParts.js');

const NAME = `kuerzen_${process.pid}`,
  TEIL = '3001kz';

test('trimming works completely or not at all', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, $2, 5, 'manual')`, [uid, TEIL]);
  const alt = (
    await db.get(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, created_at)
                             VALUES ($1, $2, 5, 3, NOW() - INTERVAL '3 days') RETURNING id`,
      [uid, TEIL],
    )
  ).id;
  await db.run(
    `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, created_at)
                VALUES ($1, $2, 5, 2, NOW() - INTERVAL '1 day')`,
    [uid, TEIL],
  );
  const fn = `kuerzen_sperre_${process.pid}`;
  await db.run(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF OLD.id = ${alt} THEN RAISE EXCEPTION 'erzwungener Fehler'; END IF; RETURN NEW; END $$`);
  await db.run(`CREATE TRIGGER ${fn} BEFORE UPDATE ON part_acquisitions FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  t.after(async () => {
    await db.run(`DROP TRIGGER IF EXISTS ${fn} ON part_acquisitions`).catch(() => {});
    await db.run(`DROP FUNCTION IF EXISTS ${fn}()`).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const erfassungen = async () =>
    (await db.all('SELECT quantity FROM part_acquisitions WHERE user_id = $1 ORDER BY created_at', [uid])).map(
      r => r.quantity,
    );

  await t.test('nothing half trimmed', async () => {
    assert.deepEqual(await erfassungen(), [3, 2], 'Vorbedingung');
    // 5 → 1: the newer one (2) gone, shorten the older one by 2 — there the trigger applies.
    await assert.rejects(changeManualPart(uid, TEIL, 5, { quantity: 1 }), /erzwungener Fehler/);
    assert.deepEqual(await erfassungen(), [3, 2], 'Die neuere Erfassung ist weg, die ältere nicht gekürzt');
  });

  await t.test('without errors trimming happens', async () => {
    await db.run(`DROP TRIGGER ${fn} ON part_acquisitions`);
    await changeManualPart(uid, TEIL, 5, { quantity: 1 });
    assert.deepEqual(await erfassungen(), [1]);
  });
});
