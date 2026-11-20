#!/usr/bin/env node
'use strict';
/**
 * Zeilentypen aus dem Schema: liest db/schema-stand.sql und schreibt db/rows.ts. Ein
 * Repository bindet seine Zeile daran (`Spalten<'price_cache', 'avg_price'>`), statt die
 * Spaltentypen neu zu raten; NUMERIC kommt als Zahl an (db/database.ts), BIGINT als Text.
 * `node scripts/row-types.js --pruefen` meldet nur, ob die Datei dem Schema entspricht.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = path.join(ROOT, 'db', 'schema-stand.sql');
const ZIEL = path.join(ROOT, 'db', 'rows.ts');

/** Was node-pg (mit dem NUMERIC-Leser aus db/database.ts) für einen PostgreSQL-Typ liefert. */
/** @type {[RegExp, string][]} */
const JS_TYPE = [
  [/^(integer|smallint|real|double precision|numeric(\(\d+,\d+\))?)$/, 'number'],
  [/^(text|bigint|uuid|character( varying)?(\(\d+\))?)$/, 'string'],
  [/^boolean$/, 'boolean'],
  [/^(timestamp with time zone|timestamp without time zone|date)$/, 'Date'],
  [/^jsonb?$/, 'unknown'],
  [/^bytea$/, 'Buffer'],
];

/** @param {string} pg */
function jsType(pg) {
  const liste = pg.endsWith('[]');
  const basis = liste ? pg.slice(0, -2) : pg;
  const treffer = JS_TYPE.find(([m]) => m.test(basis));
  if (!treffer) throw new Error(`Unbekannter Spaltentyp „${pg}“: in scripts/row-types.js eintragen`);
  return liste ? `${treffer[1]}[]` : treffer[1];
}

/** @param {string} sql @returns {Map<string, { name: string, typ: string, null: boolean }[]>} */
function tabellen(sql) {
  /** @type {Map<string, { name: string, typ: string, null: boolean }[]>} */
  const aus = new Map();
  for (const m of sql.matchAll(/^CREATE TABLE (\w+) \(\n([\s\S]*?)\n\);/gm)) {
    const spalten = [];
    for (const z of (m[2] ?? '').split('\n')) {
      const s = /^ {2}("?[a-z_][a-z0-9_]*"?) (.+?),?$/.exec(z);
      if (!s || /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i.test(s[1] ?? '')) continue;
      const rest = s[2] ?? '';
      const typ = rest
        .replace(/ (NOT NULL|DEFAULT|GENERATED|COLLATE|CONSTRAINT)\b.*$/, '')
        .replace(/ (NOT NULL|DEFAULT).*$/, '')
        .trim();
      spalten.push({ name: (s[1] ?? '').replace(/"/g, ''), typ, null: !/\bNOT NULL\b/.test(rest) });
    }
    aus.set(m[1] ?? '', spalten);
  }
  return aus;
}

function create() {
  const t = tabellen(fs.readFileSync(SCHEMA, 'utf8'));
  const zeilen = [
    '// Erzeugt von scripts/row-types.js aus db/schema-stand.sql; nicht von Hand ändern.',
    '// Neu erzeugen nach jeder Migration: npm run schema:stand && npm run schema:zeilen',
    '',
    '/** Je Tabelle die Spalten, wie node-pg sie liefert (NUMERIC als Zahl, BIGINT als Text). */',
    'export interface Tabellen {',
  ];
  for (const [name, spalten] of [...t].sort(([a], [b]) => a.localeCompare(b))) {
    zeilen.push(`  ${name}: {`);
    for (const s of spalten) zeilen.push(`    ${s.name}: ${jsType(s.typ)}${s.null ? ' | null' : ''};`);
    zeilen.push('  };');
  }
  zeilen.push(
    '}',
    '',
    '/** Ausgewählte Spalten einer Tabelle: `Spalten<"sets", "user_id" | "set_number">`. */',
    'export type Spalten<T extends keyof Tabellen, S extends keyof Tabellen[T]> = Pick<Tabellen[T], S>;',
    '',
  );
  return zeilen.join('\n');
}

module.exports = { create, jsType, tabellen, ZIEL };

if (require.main === module) {
  const neu = create();
  if (process.argv.includes('--pruefen')) {
    const alt = fs.existsSync(ZIEL) ? fs.readFileSync(ZIEL, 'utf8') : '';
    if (alt !== neu) {
      console.error('[zeilentypen] db/rows.ts passt nicht zum Schema: npm run schema:zeilen');
      process.exit(1);
    }
    console.log('[zeilentypen] db/rows.ts passt zum Schema');
  } else {
    fs.writeFileSync(ZIEL, neu);
    console.log(`[zeilentypen] ${path.relative(ROOT, ZIEL)} geschrieben`);
  }
}
