#!/usr/bin/env node
'use strict';

/**
 * Schreibt frontend-typen/vertrag.d.ts aus docs/openapi.json: die Antwort
 * jeder Route als TypeScript-Typ, damit tsc die api()-Aufrufe der Oberfläche
 * gegen den Vertrag prüft. Die Datei ist eingecheckt;
 * test/vertrag-frontend-typen.test.js prüft, dass sie zu openapi.json passt.
 *
 *   npm run vertrag:frontend
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const QUELLE = path.join(ROOT, 'docs', 'openapi.json');
const ZIEL = path.join(ROOT, 'frontend-typen', 'vertrag.d.ts');

const NAME = /^[A-Za-z_$][\w$]*$/;
const schluessel = (/** @type {string} */ k) => (NAME.test(k) ? k : JSON.stringify(k));

/** Ein JSON-Schema als TypeScript-Typ. @param {any} s @param {string} einzug @returns {string} */
function typ(s, einzug) {
  if (!s || typeof s !== 'object' || Object.keys(s).length === 0) return 'unknown';
  if (s.$ref) return s.$ref.split('/').pop();
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((/** @type {unknown} */ e) => JSON.stringify(e)).join(' | ');
  if (s.anyOf || s.oneOf)
    return [...new Set((s.anyOf || s.oneOf).map((/** @type {any} */ t) => typ(t, einzug)))].join(' | ');
  if (s.allOf) return s.allOf.map((/** @type {any} */ t) => typ(t, einzug)).join(' & ');
  if (Array.isArray(s.type)) return s.type.map((/** @type {string} */ t) => typ({ ...s, type: t }, einzug)).join(' | ');
  switch (s.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const t = typ(s.items, einzug);
      return /[|&]/.test(t) ? `Array<${t}>` : `${t}[]`;
    }
    case 'object':
      return objekt(s, einzug);
    default:
      return 'unknown';
  }
}

/** @param {any} s @param {string} einzug */
function objekt(s, einzug) {
  const innen = einzug + '  ';
  const pflicht = new Set(s.required || []);
  const zeilen = Object.entries(s.properties || {}).map(
    ([k, v]) => `${innen}${schluessel(k)}${pflicht.has(k) ? '' : '?'}: ${typ(v, innen)};`,
  );
  // Der Server reicht weitere Felder durch (passthrough); gelesen werden sie
  // erst, wenn der Vertrag sie nennt.
  const ap = s.additionalProperties;
  if (ap && !zeilen.length) return `Record<string, ${typ(ap, einzug)}>`;
  if (ap) zeilen.push(`${innen}[feld: string]: unknown;`);
  return zeilen.length ? `{\n${zeilen.join('\n')}\n${einzug}}` : 'Record<string, never>';
}

/** Der Inhalt von vertrag.d.ts. @param {any} dok @returns {string} */
function erzeuge(dok) {
  const aus = [
    '// Erzeugt von scripts/vertrag-frontend-typen.js aus docs/openapi.json — nicht von Hand ändern.',
    '// Neu schreiben: npm run vertrag:frontend',
    '',
  ];
  for (const [name, s] of Object.entries(dok.components?.schemas || {}))
    aus.push(`export type ${name} = ${typ(s, '')};`);
  aus.push(
    '',
    '/** Je Route: Methode, Pfad (Platzhalter als ${string}) und Antwort bei Erfolg. */',
    'export type Route =',
  );
  const routen = [];
  for (const [pfad, ops] of Object.entries(dok.paths || {})) {
    const muster = pfad.replace(/^\/api/, '').replace(/\{[^}]+\}/g, '${string}');
    for (const [methode, op] of Object.entries(/** @type {Record<string, any>} */ (ops))) {
      const schema = op.responses?.['200']?.content?.['application/json']?.schema;
      if (!schema) continue;
      const p = muster.includes('${') ? '`' + muster + '`' : `'${muster}'`;
      routen.push(`  | { m: '${methode.toUpperCase()}'; p: ${p}; a: ${typ(schema, '  ')} }`);
    }
  }
  aus.push(...routen.map((z, i) => (i === routen.length - 1 ? z + ';' : z)), '');
  return aus.join('\n');
}

/** Gleich im Biome-Format, sonst wäre jeder Neulauf ein Formatfund. @param {string} text @returns {string} */
function formatiert(text) {
  const biome = path.join(ROOT, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
  const r = require('node:child_process').spawnSync(
    process.execPath,
    [biome, 'format', `--stdin-file-path=${path.relative(ROOT, ZIEL)}`],
    { cwd: ROOT, input: text, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`biome format scheiterte (Exit ${r.status}):\n${r.stderr}`);
  return r.stdout;
}

if (require.main === module) {
  fs.writeFileSync(ZIEL, formatiert(erzeuge(JSON.parse(fs.readFileSync(QUELLE, 'utf8')))));
  console.log(`geschrieben: ${path.relative(ROOT, ZIEL)}`);
}

module.exports = { QUELLE, ZIEL, erzeuge, formatiert };
