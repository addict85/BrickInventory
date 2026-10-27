/**
 * Eine frische Datenbank, aufgebaut wie beim ersten Start: Jede Kontospalte
 * hat einen Fremdschlüssel auf users, ein Konto lässt sich samt allem löschen,
 * und ein zweiter Start ändert am Schema nichts.
 *
 * Das Schema entsteht aus schema.sql, den Schritten in db/database.ts und den
 * Migrationen. Sieben Tabellen hatten so keinen Fremdschlüssel; beim Löschen
 * eines Kontos blieben ihre Zeilen stehen, bei den Erfassungen samt Kaufpreisen.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  Migration 0043 umbenannt in .sql.aus → rot: „jede Kontospalte hat einen
 *      Fremdschlüssel" (sieben Spalten), „ein Konto verschwindet ganz" und
 *      „das Löschen sucht über einen Index" (account_link_invites)
 *   E  in 0043 den Schlüssel auch auf parts_version_user → rot: „ein Konto
 *      verschwindet ganz" (das Löschen scheitert am Zähltrigger)
 *   B  in 0043 den Index idx_qr_login_user entfernt → rot: „das Löschen sucht
 *      über einen Index"
 *   C  der zweite Start über initSchema() statt initSchemaOnce() → rot: „ein
 *      zweiter Start ändert am Schema nichts" — initSchema legt die von 0036
 *      bis 0038 gelöschten Spalten wieder an. Darum läuft es nur einmal.
 *   F  in db/schema-stand.sql eine Spalte gelöscht → rot: „db/schema-stand.sql
 *      zeigt das Schema, das entsteht"; ebenso eine neue Migration ohne neu
 *      erzeugte Datei
 *   D  in initSchemaOnce den Aufruf abgeloestesEntfernen() entfernt → rot:
 *      „auch ein erzwungener Lauf holt Gelöschtes nicht zurück" (elf Spalten
 *      und rb_bl_mapping kamen zurück)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (darf Datenbanken anlegen).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASIS = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const NAME = `schema_frisch_${process.pid}`;
const ziel = new URL(BASIS); ziel.pathname = '/' + NAME;
process.env.DATABASE_URL = ziel.toString();
process.env.WEB_WORKERS = '1';

const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
const _req = require('./helpers/sources').buildAndRequire();

const KONTOSPALTEN = ['user_id', 'main_user_id', 'sub_user_id'];
/** Bewusst ohne Schlüssel — mit Grund. */
const OHNE_SCHLUESSEL = new Map([
  ['parts_version_user.user_id', 'Die Zähltrigger schreiben dort auch beim kaskadierten Löschen eines Kontos'],
]);

async function schemaAbbild(db) {
  const spalten = await db.all(`SELECT table_name, column_name, data_type, is_nullable, column_default
                                  FROM information_schema.columns WHERE table_schema = 'public'
                                 ORDER BY 1, 2`);
  const schranken = await db.all(`SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS d
                                    FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`);
  const indizes = await db.all(`SELECT tablename, indexname, indexdef FROM pg_indexes
                                 WHERE schemaname = 'public' ORDER BY 1, 2`);
  return { spalten, schranken, indizes };
}

test('frische Datenbank', { concurrency: 1, timeout: 180_000 }, async (t) => {
  const admin = new Client({ connectionString: BASIS });
  try { await admin.connect(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);

  const db = _req('db/database.js');
  // Derselbe Weg wie beim Serverstart: initSchema nur beim ersten Mal, die
  // Migrationen immer.
  const starte = () => db.initSchemaOnce();
  t.after(async () => {
    await db.pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`).catch(() => {});
    await admin.end().catch(() => {});
  });

  await starte();

  await t.test('jede Kontospalte hat einen Fremdschlüssel', async () => {
    const offen = await db.all(`
      SELECT c.table_name || '.' || c.column_name AS spalte
        FROM information_schema.columns c
        JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = 'public'
                                         AND tb.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public' AND c.column_name = ANY($1)
         AND NOT EXISTS (
           SELECT 1 FROM pg_constraint k
            WHERE k.contype = 'f' AND k.conrelid = (quote_ident(c.table_name))::regclass
              AND k.confrelid = 'users'::regclass
              AND (SELECT attname FROM pg_attribute WHERE attrelid = k.conrelid AND attnum = k.conkey[1]) = c.column_name)
       ORDER BY 1`, [KONTOSPALTEN]);
    assert.deepEqual(offen.map(r => r.spalte).filter(s => !OHNE_SCHLUESSEL.has(s)), []);
    const alle = await db.get(`SELECT COUNT(*)::int AS n FROM information_schema.columns
                                WHERE table_schema = 'public' AND column_name = ANY($1)`, [KONTOSPALTEN]);
    assert.ok(alle.n >= 20, `Nur ${alle.n} Kontospalten gefunden — greift die Suche noch?`);
  });

  await t.test('ein Konto verschwindet ganz', async () => {
    const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                                VALUES ('frisch_loeschen', 'x', 1, 1) RETURNING id`)).id;
    await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price)
                  VALUES ($1, '3001', 5, 2, 0.12)`, [uid]);
    await db.run(`INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price)
                  VALUES ($1, 'sw0001', 1, 9.5)`, [uid]);
    await db.run(`INSERT INTO qr_login_tokens (token, user_id, expires_at) VALUES ('frisch', $1, NOW())`, [uid]);
    // Bestand, damit die Zähltrigger auf parts und sets beim Löschen feuern.
    await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, '3001', 5, 'manual')`, [uid]);
    await db.run(`INSERT INTO set_catalog (set_number, name) VALUES ('99073-1', 'Frisch') ON CONFLICT DO NOTHING`);
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '99073-1')`, [uid]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    for (const tab of ['part_acquisitions', 'minifig_acquisitions', 'qr_login_tokens', 'parts', 'sets'])
      assert.equal((await db.get(`SELECT COUNT(*)::int AS n FROM ${tab} WHERE user_id = $1`, [uid])).n, 0,
        `${tab} behält Zeilen eines gelöschten Kontos`);
  });

  await t.test('das Löschen sucht über einen Index', async () => {
    const ohne = await db.all(`
      SELECT k.conrelid::regclass::text AS t FROM pg_constraint k
       WHERE k.contype = 'f' AND k.confrelid = 'users'::regclass
         AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.conrelid AND i.indkey[0] = k.conkey[1])
       ORDER BY 1`);
    assert.deepEqual(ohne.map(r => r.t), [], 'Ohne Index durchsucht jedes Löschen eines Kontos die ganze Tabelle');
  });

  await t.test('db/schema-stand.sql zeigt das Schema, das entsteht', async () => {
    const { schemaText, DATEI } = require(path.join(ROOT, 'scripts', 'schema-stand.js'));
    const eingecheckt = require('node:fs').readFileSync(DATEI, 'utf8');
    assert.equal(await schemaText(db), eingecheckt,
      'db/schema-stand.sql ist veraltet — neu erzeugen: npm run build && npm run schema:stand');
  });

  await t.test('ein zweiter Start ändert am Schema nichts', async () => {
    const vorher = await schemaAbbild(db);
    await starte();
    assert.deepEqual(await schemaAbbild(db), vorher);
  });

  await t.test('auch ein erzwungener Lauf holt Gelöschtes nicht zurück', async () => {
    const vorher = await schemaAbbild(db);
    process.env.FORCE_SCHEMA_INIT = '1';
    try { await starte(); } finally { delete process.env.FORCE_SCHEMA_INIT; }
    assert.deepEqual(await schemaAbbild(db), vorher,
      'FORCE_SCHEMA_INIT legt Spalten wieder an, die Migrationen gelöscht haben');
  });
});
