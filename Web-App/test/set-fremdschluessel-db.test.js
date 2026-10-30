/**
 * Teile, Figuren und Anleitungen eines Sets hängen per Fremdschlüssel am Set
 * ihres Kontos; Quelle und Status haben geschlossene Wertemengen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  parts_set_fk ohne ON DELETE CASCADE angelegt → rot: „ein gelöschtes
 *      Set nimmt seinen Inhalt mit“
 *   B  in Migration 0058 die Ausnahme im Prüfblock entfernt → rot: „eine
 *      Altlast hält die Migration nicht an“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltSet, haeltTeil, haeltFigur } = require('./helpers/bestand');

const MIGRATION = path.join(ROOT, 'db', 'migrations', '0058-fremdschluessel-und-pruefungen.sql');
const SCHLUESSEL = [['parts', 'parts_set_fk'], ['minifigs', 'minifigs_set_fk'],
  ['instructions', 'instructions_set_fk'], ['parts', 'parts_source_check'],
  ['minifigs', 'minifigs_source_check'], ['instruction_queue', 'instruction_queue_status_check'],
  ['csv_import_jobs', 'csv_import_jobs_status_check']];

test('Set-Inhalte und Wertemengen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const NAME = `fk-${process.pid}`, ANDERER = `fk-b-${process.pid}`;
  const SN = `77${process.pid % 1000}-1`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, ANDERER]]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  const andere = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [ANDERER])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, andere]]);
    await db.pool.end().catch(() => {});
  });

  await t.test('ein gelöschtes Set nimmt seinen Inhalt mit — nur im eigenen Konto', async () => {
    for (const k of [uid, andere]) {
      await haeltSet(db, k, SN, 1);
      await haeltTeil(db, k, '3001', { setNumber: SN, menge: 4 });
      await haeltFigur(db, k, 'sw0001', { setNumber: SN });
      await db.run(`INSERT INTO instructions (user_id, set_number, url) VALUES ($1, $2, 'x.pdf')`, [k, SN]);
    }
    // Die Erfassungen zuerst: set_acquisitions sperrt das Löschen eines Sets
    // mit Bestand absichtlich (set_acquisitions_bestand_fkey).
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1 AND set_number = $2', [uid, SN]);
    await db.run('DELETE FROM sets WHERE user_id = $1 AND set_number = $2', [uid, SN]);
    for (const tab of ['parts', 'minifigs', 'instructions']) {
      const n = async (k) => Number((await db.get(
        `SELECT COUNT(*) AS n FROM ${tab} WHERE user_id = $1 AND set_number = $2`, [k, SN])).n);
      assert.equal(await n(uid), 0, `${tab} des gelöschten Sets blieb stehen`);
      assert.equal(await n(andere), 1, `${tab} des anderen Kontos wurde mitgelöscht`);
    }
  });

  await t.test('ein Teil ohne Set wird beim Abschluss abgewiesen', async () => {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.run(`INSERT INTO parts (user_id, set_number, part_number, color_id) VALUES ($1, 'gibtsnicht-1', '3001', 0)`, [uid]);
    }), /parts_set_fk/);
    // Erst Inhalt, dann Set — in EINER Transaktion zulässig.
    await db.transaction(async (tx) => {
      await tx.run(`INSERT INTO parts (user_id, set_number, part_number, color_id) VALUES ($1, $2, '3002', 0)`, [uid, SN]);
      await tx.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, $2)`, [uid, SN]);
    });
  });

  await t.test('erfundene Quelle und erfundener Status werden abgewiesen', async () => {
    await assert.rejects(db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3003', 0, 'kiste')`, [uid]),
      /parts_source_check/);
    await assert.rejects(db.run(`INSERT INTO instruction_queue (set_number, status) VALUES ($1, 'fertig')`, [SN]),
      /instruction_queue_status_check/);
    await assert.rejects(db.run(`INSERT INTO csv_import_jobs (user_id, status) VALUES ($1, 'fertig')`, [uid]),
      /csv_import_jobs_status_check/);
  });

  await t.test('eine Altlast hält die Migration nicht an', async () => {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      for (const [tab, name] of SCHLUESSEL) await c.query(`ALTER TABLE ${tab} DROP CONSTRAINT ${name}`);
      await c.query(`INSERT INTO parts (user_id, set_number, part_number, color_id) VALUES ($1, 'verwaist-1', '3001', 0)`, [uid]);
      await c.query(fs.readFileSync(MIGRATION, 'utf8'));
      const r = await c.query(`SELECT conname, convalidated FROM pg_constraint WHERE conname = ANY($1)`,
        [SCHLUESSEL.map(s => s[1])]);
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
