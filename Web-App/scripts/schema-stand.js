'use strict';
/**
 * Das vollständige Schema an einer Stelle: db/schema-stand.sql.
 *
 * Das Schema entsteht aus schema.sql, den Schritten in db/database.ts und den
 * Migrationen — keine der drei Quellen zeigt das Ergebnis. Dieses Skript baut
 * eine frische Datenbank wie beim ersten Start und schreibt aus dem Katalog,
 * was dabei herauskommt: Tabellen mit Spalten, Schranken, Indizes, Trigger,
 * Funktionen. Die Datei ist zum Lesen da, nicht zum Einspielen.
 *
 * Aufruf (nach `npm run build`): npm run schema:stand
 * test/schema-frisch-db.test.js vergleicht die Datei mit einer frischen
 * Datenbank; weicht sie ab, ist sie neu zu erzeugen.
 */
const fs = require('fs');
const path = require('path');

const DATEI = path.join(__dirname, '..', 'db', 'schema-stand.sql');

/**
 * Der Text der Schemadatei aus einer verbundenen Datenbank.
 * @param {{ all: (sql: string, werte?: unknown[]) => Promise<any[]> }} db
 * @returns {Promise<string>}
 */
async function schemaText(db) {
  const spalten = await db.all(`
    SELECT c.relname AS tabelle, a.attname AS spalte, format_type(a.atttypid, a.atttypmod) AS typ,
           a.attnotnull AS pflicht, pg_get_expr(d.adbin, d.adrelid) AS vorgabe
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE c.relkind IN ('r', 'p')
     ORDER BY c.relname, a.attnum`);
  const schranken = await db.all(`
    SELECT conrelid::regclass::text AS tabelle, conname AS name, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid <> 0
       AND contype <> 'n'  -- ab PG 18 stehen NOT NULL auch hier; die Spalte zeigt sie schon
     ORDER BY 1, 2`);
  const indizes = await db.all(`
    SELECT i.tablename AS tabelle, i.indexdef AS def FROM pg_indexes i
     WHERE i.schemaname = 'public'
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conname = i.indexname AND k.connamespace = 'public'::regnamespace)
     ORDER BY 1, i.indexname`);
  const trigger = await db.all(`
    SELECT tgrelid::regclass::text AS tabelle, pg_get_triggerdef(oid) AS def
      FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, tgname`);
  const funktionen = await db.all(`
    SELECT p.proname AS name, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
     WHERE d.objid IS NULL ORDER BY 1, 2`);
  const erweiterungen = await db.all(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);

  /** @param {any[]} zeilen @param {string} tabelle */
  const von = (zeilen, tabelle) => zeilen.filter(z => z.tabelle === tabelle);
  const tabellen = [...new Set(spalten.map(s => s.tabelle))];
  const teile = [
    '-- Erzeugt von scripts/schema-stand.js aus einer frischen Datenbank.',
    '-- Nicht von Hand ändern und nicht einspielen: Das Schema entsteht aus',
    '-- db/schema.sql, db/database.ts und db/migrations/. Neu erzeugen mit',
    '-- `npm run build && npm run schema:stand`.',
    '',
    ...erweiterungen.map(e => `CREATE EXTENSION ${e.extname};`),
  ];
  for (const t of tabellen) {
    const zeilen = von(spalten, t).map(s =>
      `  ${s.spalte} ${s.typ}${s.pflicht ? ' NOT NULL' : ''}${s.vorgabe != null ? ` DEFAULT ${s.vorgabe}` : ''}`);
    zeilen.push(...von(schranken, t).map(k => `  CONSTRAINT ${k.name} ${k.def}`));
    teile.push('', `CREATE TABLE ${t} (`, zeilen.join(',\n'), ');');
    teile.push(...von(indizes, t).map(i => `${i.def.replace(/ ON public\./, ' ON ')};`));
    teile.push(...von(trigger, t).map(g => `${g.def.replace(/ ON public\./, ' ON ')};`));
  }
  for (const f of funktionen) teile.push('', `${f.def.trim()};`);
  return teile.join('\n').replace(/public\./g, '') + '\n';
}

/** Eine frische Datenbank anlegen, aufbauen, beschreiben, wieder löschen. */
async function main() {
  const basis = process.env.DATABASE_URL;
  if (!basis) throw new Error('DATABASE_URL fehlt (eine Datenbank, deren Benutzer Datenbanken anlegen darf)');
  const { Client } = require('pg');
  const name = `schema_stand_${process.pid}`;
  const admin = new Client({ connectionString: basis });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  const ziel = new URL(basis); ziel.pathname = '/' + name;
  process.env.DATABASE_URL = ziel.toString();
  process.env.WEB_WORKERS = '1';
  const db = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));
  try {
    await db.initSchemaOnce();
    fs.writeFileSync(DATEI, await schemaText(db));
    console.log(`geschrieben: ${path.relative(process.cwd(), DATEI)}`);
  } finally {
    await db.pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
    await admin.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { schemaText, DATEI };
