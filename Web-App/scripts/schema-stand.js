'use strict';
/**
 * Das vollständige Schema an einer Stelle: db/schema-stand.sql.
 *
 * Das Schema entsteht aus db/basis.sql und den Migrationen; keine der
 * beiden Quellen zeigt das Ergebnis lesbar. Dieses Skript baut
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

const DATEI = path.join(__dirname, '..', 'db/schema-stand.sql');

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
    '-- db/basis.sql und db/migrations/. Neu erzeugen mit',
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

const BASIS = path.join(__dirname, '..', 'db/basis.sql');
/** Startdaten, die eine neue Installation braucht; alles andere bleibt leer. */
const BASIS_DATEN = ['global_settings', 'gutschein_guthaben_schranke', 'schema_migrations'];

/**
 * db/basis.sql aus einer fertig migrierten Datenbank schreiben: Schema und
 * Startdaten als ausführbares SQL. Braucht pg_dump im Pfad.
 * @param {string} url
 */
function schreibeBasis(url) {
  const { execFileSync } = require('child_process');
  /** @param {string[]} args */
  const dump = (args) => execFileSync('pg_dump', [...args, '--no-owner', '--no-privileges', '--no-comments', url],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const roh = dump(['--schema-only']) + '\n' +
    dump(['--data-only', '--column-inserts', ...BASIS_DATEN.flatMap(t => ['-t', `public.${t}`])]);
  // Weg damit: psql-Befehle (\restrict), die Leerung des Suchpfads (die
  // Funktionen der Trigger suchen ihre Tabellen ohne Schemaangabe) und die
  // Versionszeilen, die bei jedem pg_dump anders aussehen.
  const sauber = roh.split('\n').filter(z =>
    !/^\\(un)?restrict\b/.test(z) &&
    !/^SELECT pg_catalog\.set_config\('search_path'/.test(z) &&
    !/^-- Dumped (from|by)/.test(z)).join('\n').replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(BASIS, [
    '-- Schema einer NEUEN Installation: Abbild aller Migrationen, die es bei',
    '-- seiner Erzeugung gab. db/database.ts spielt es in eine leere Datenbank,',
    '-- danach laufen nur die jüngeren Migrationen. Nicht von Hand ändern —',
    '-- neu erzeugen mit `npm run build && npm run schema:stand`.',
    '',
  ].join('\n') + sauber);
  console.log(`geschrieben: ${path.relative(process.cwd(), BASIS)}`);
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
  const db = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));
  try {
    await db.initSchemaOnce();
    fs.writeFileSync(DATEI, await schemaText(db));
    console.log(`geschrieben: ${path.relative(process.cwd(), DATEI)}`);
    // Das erste Konto legt der Server an, es gehört nicht in die Basis.
    await db.run('DELETE FROM users');
    schreibeBasis(ziel.toString());
  } finally {
    await db.pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
    await admin.end();
  }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { schemaText, schreibeBasis, DATEI, BASIS };
