/**
 * Parts, figures and instructions of a set hang via foreign key on the set
 * of their account; source and status have closed value sets.
 *
 * Counter-checks (measured on 28.10.2026):
 *   A  parts_set_fk created without ON DELETE CASCADE → red: “a deleted
 *      set takes its contents along”
 *   B  the exception in the check block removed in migration 0058 → red: “a
 *      legacy issue does not stop the migration”
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
const { holdsSet, holdsPart, holdsMinifig } = require('./helpers/inventory');

const MIGRATION = path.join(ROOT, 'db/migrations/0058-fremdschluessel-und-pruefungen.sql');
const SCHLUESSEL = [
  ['parts', 'parts_set_fk'],
  ['minifigs', 'minifigs_set_fk'],
  ['instructions', 'instructions_set_fk'],
  ['parts', 'parts_source_check'],
  ['minifigs', 'minifigs_source_check'],
  ['instruction_queue', 'instruction_queue_status_check'],
  ['csv_import_jobs', 'csv_import_jobs_status_check'],
];

test('set contents and value sets', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const NAME = `fk-${process.pid}`,
    ANDERER = `fk-b-${process.pid}`;
  const SN = `77${process.pid % 1000}-1`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, ANDERER]]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  const andere = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [ANDERER]))
    .id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, andere]]);
    await db.pool.end().catch(() => {});
  });

  await t.test('a deleted set takes its contents along — only in the own account', async () => {
    for (const k of [uid, andere]) {
      await holdsSet(db, k, SN, 1);
      await holdsPart(db, k, '3001', { setNumber: SN, menge: 4 });
      await holdsMinifig(db, k, 'sw0001', { setNumber: SN });
      await db.run(`INSERT INTO instructions (user_id, set_number, url) VALUES ($1, $2, 'x.pdf')`, [k, SN]);
    }
    // The acquisitions first: set_acquisitions deliberately blocks deleting a set
    // with inventory (set_acquisitions_bestand_fkey).
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1 AND set_number = $2', [uid, SN]);
    await db.run('DELETE FROM sets WHERE user_id = $1 AND set_number = $2', [uid, SN]);
    for (const tab of ['parts', 'minifigs', 'instructions']) {
      const n = async k =>
        Number((await db.get(`SELECT COUNT(*) AS n FROM ${tab} WHERE user_id = $1 AND set_number = $2`, [k, SN])).n);
      assert.equal(await n(uid), 0, `${tab} des gelöschten Sets blieb stehen`);
      assert.equal(await n(andere), 1, `${tab} des anderen Kontos wurde mitgelöscht`);
    }
  });

  await t.test('a part without a set is rejected on completion', async () => {
    await assert.rejects(
      db.transaction(async tx => {
        await tx.run(
          `INSERT INTO parts (user_id, set_number, part_number, color_id) VALUES ($1, 'gibtsnicht-1', '3001', 0)`,
          [uid],
        );
      }),
      /parts_set_fk/,
    );
    // First contents, then set — allowed in ONE transaction.
    await db.transaction(async tx => {
      await tx.run(`INSERT INTO parts (user_id, set_number, part_number, color_id) VALUES ($1, $2, '3002', 0)`, [
        uid,
        SN,
      ]);
      await tx.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, $2)`, [uid, SN]);
    });
  });

  await t.test('invented source and invented status are rejected', async () => {
    await assert.rejects(
      db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3003', 0, 'kiste')`, [uid]),
      /parts_source_check/,
    );
    await assert.rejects(
      db.run(`INSERT INTO import_status (user_id, status) VALUES ($1, 'fertig')`, [uid]),
      /import_status_status_check/,
    );
  });

  await t.test('a legacy issue does not stop the migration', async () => {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      // The migration dates from the time before 0083: recreate its tables for the duration of the probe.
      await c.query(`CREATE TABLE instruction_queue (set_number TEXT, status TEXT,
                       CONSTRAINT instruction_queue_status_check CHECK (status IN ('pending','done','failed')))`);
      await c.query('ALTER TABLE import_status RENAME TO csv_import_jobs');
      // The constraint name of that time; 0127 gave it the name of the table.
      await c.query(
        'ALTER TABLE csv_import_jobs RENAME CONSTRAINT import_status_status_check TO csv_import_jobs_status_check',
      );
      for (const [tab, name] of SCHLUESSEL) await c.query(`ALTER TABLE ${tab} DROP CONSTRAINT ${name}`);
      await c.query(
        `INSERT INTO parts (user_id, set_number, part_number, color_id) VALUES ($1, 'verwaist-1', '3001', 0)`,
        [uid],
      );
      await c.query(fs.readFileSync(MIGRATION, 'utf8'));
      const r = await c.query(`SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1)`, [
        SCHLUESSEL.map(s => s[1]),
      ]);
      const stand = Object.fromEntries(r.rows.map(z => [z.conname, z.convalidated]));
      assert.equal(Object.keys(stand).length, SCHLUESSEL.length, 'nicht jeder Schlüssel wurde angelegt');
      assert.equal(stand.parts_set_fk, false, 'der verletzte Schlüssel gilt als geprüft');
      assert.equal(stand.minifigs_set_fk, true, 'ein sauberer Schlüssel blieb ungeprüft');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
