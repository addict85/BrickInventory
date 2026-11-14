#!/usr/bin/env node
'use strict';

/**
 * Schreibt die Kotlin-Antworttypen der App (core-vertrag, vertrag.erzeugt) aus
 * docs/openapi.json, ohne Netz und ohne Gradle. Eingecheckt; mit --pruefen nur
 * vergleichen (Rückgabe 1 bei Abweichung). Aufruf: npm run vertrag:kotlin
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const QUELLE = path.join(ROOT, 'docs', 'openapi.json');
const ZIEL = path.join(
  ROOT,
  '..',
  'Android-App',
  'core-vertrag',
  'src',
  'main',
  'java',
  'ch',
  'brickinventoryapp',
  'vertrag',
  'erzeugt',
  'Vertrag.kt',
);

const SCHLUESSELWOERTER = new Set([
  'as',
  'break',
  'class',
  'continue',
  'do',
  'else',
  'false',
  'for',
  'fun',
  'if',
  'in',
  'interface',
  'is',
  'null',
  'object',
  'package',
  'return',
  'super',
  'this',
  'throw',
  'true',
  'try',
  'typealias',
  'typeof',
  'val',
  'var',
  'when',
  'while',
]);

/** Ein Schema-Name als Kotlin-Klassenname: Wortteile gross, ohne Unterstriche. @param {string} n */
const klassenname = n =>
  n
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(t => t.charAt(0).toUpperCase() + t.slice(1))
    .join('');

/** Ein JSON-Feldname als Kotlin-Eigenschaft (snake_case → camelCase). @param {string} n */
function eigenschaft(n) {
  const teile = n.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let e = teile.map((t, i) => (i === 0 ? t.charAt(0).toLowerCase() : t.charAt(0).toUpperCase()) + t.slice(1)).join('');
  if (/^[0-9]/.test(e)) e = `n${e}`;
  return SCHLUESSELWOERTER.has(e) ? `\`${e}\`` : e;
}

/** Ein Aufzählungswert als Konstante. @param {string} w */
const konstante = w => {
  const k = w
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /^[0-9]/.test(k) ? `W_${k}` : k || 'LEER';
};

/**
 * Der Kotlin-Typ eines Schemas, ohne Nullbarkeit; null-Zweige setzen `nullbar`.
 * Verschachtelte Objekte werden als eigene Klasse [neben] gesammelt.
 * @param {any} s @param {string} vorschlag @param {(name: string, s: any) => void} neben
 * @returns {{ typ: string, nullbar: boolean }}
 */
function typ(s, vorschlag, neben) {
  if (!s || typeof s !== 'object' || Object.keys(s).length === 0) return { typ: 'JsonElement', nullbar: true };
  if (s.$ref) return { typ: klassenname(s.$ref.split('/').pop()), nullbar: false };
  if (s.const !== undefined)
    return { typ: grundtyp(typeof s.const === 'number' ? 'number' : typeof s.const), nullbar: false };
  if (s.enum)
    return {
      typ: s.enum.every((/** @type {unknown} */ e) => typeof e === 'string') ? 'String' : 'JsonElement',
      nullbar: false,
    };
  const zweige = s.anyOf || s.oneOf;
  if (zweige) {
    const ohneNull = zweige.filter((/** @type {any} */ z) => z.type !== 'null');
    const nullbar = ohneNull.length < zweige.length;
    if (ohneNull.length === 1) {
      const t = typ(ohneNull[0], vorschlag, neben);
      return { typ: t.typ, nullbar: nullbar || t.nullbar };
    }
    return { typ: 'JsonElement', nullbar: true };
  }
  if (Array.isArray(s.type)) {
    const ohneNull = s.type.filter((/** @type {string} */ t) => t !== 'null');
    const nullbar = ohneNull.length < s.type.length;
    if (ohneNull.length === 1) return { typ: typ({ ...s, type: ohneNull[0] }, vorschlag, neben).typ, nullbar };
    return { typ: 'JsonElement', nullbar: true };
  }
  if (s.type === 'array') return { typ: `List<${feldtyp(s.items, `${vorschlag}Eintrag`, neben)}>`, nullbar: false };
  if (s.type === 'object') {
    if (s.properties && Object.keys(s.properties).length) {
      neben(vorschlag, s);
      return { typ: vorschlag, nullbar: false };
    }
    return { typ: 'JsonObject', nullbar: false };
  }
  if (s.type === 'integer') {
    const klein =
      s.minimum !== undefined && s.maximum !== undefined && s.minimum >= -2147483648 && s.maximum <= 2147483647;
    return { typ: klein ? 'Int' : 'Long', nullbar: false };
  }
  return { typ: grundtyp(s.type), nullbar: false };
}

/** @param {string} t */
function grundtyp(t) {
  return { string: 'String', number: 'Double', boolean: 'Boolean', null: 'JsonElement' }[t] ?? 'JsonElement';
}

/** Typ samt `?` für Listen- und Kartenelemente. @param {any} s @param {string} v @param {any} neben */
function feldtyp(s, v, neben) {
  const t = typ(s, v, neben);
  return t.nullbar ? `${t.typ}?` : t.typ;
}

/** Eine Klasse für ein Objekt-Schema; verschachtelte Objekte als weitere Klassen. @returns {string[]} */
function klasse(/** @type {string} */ name, /** @type {any} */ s) {
  /** @type {string[]} */
  const mehr = [];
  const neben = (/** @type {string} */ n, /** @type {any} */ x) => mehr.push(...klasse(n, x));
  if (s.enum) {
    const werte = s.enum.map((/** @type {string} */ w) => `    @SerialName(${JSON.stringify(w)}) ${konstante(w)},`);
    return [`@Serializable\nenum class ${name} {\n${werte.join('\n')}\n}`];
  }
  const pflicht = new Set(s.required ?? []);
  const felder = Object.entries(s.properties ?? {}).map(([json, schema]) => {
    const t = typ(schema, name + klassenname(json), neben);
    const optional = t.nullbar || !pflicht.has(json);
    return `    @SerialName(${JSON.stringify(json)}) val ${eigenschaft(json)}: ${t.typ}${optional ? '? = null' : ''},`;
  });
  const rumpf = felder.length ? `(\n${felder.join('\n')}\n)` : '';
  return [felder.length ? `@Serializable\ndata class ${name}${rumpf}` : `@Serializable\nclass ${name}`, ...mehr];
}

/** Die Kotlin-Datei aus dem OpenAPI-Dokument. @param {any} dok @returns {string} */
function erzeuge(dok) {
  const schemas = dok.components?.schemas ?? {};
  const bloecke = Object.keys(schemas)
    .sort()
    .flatMap(n => klasse(klassenname(n), schemas[n]));
  const rumpf = bloecke.join('\n\n');
  const importe = ['kotlinx.serialization.SerialName', 'kotlinx.serialization.Serializable'];
  if (/\bJsonElement\b/.test(rumpf)) importe.push('kotlinx.serialization.json.JsonElement');
  if (/\bJsonObject\b/.test(rumpf)) importe.push('kotlinx.serialization.json.JsonObject');
  return (
    '// Erzeugt aus Web-App/docs/openapi.json durch Web-App/scripts/vertrag-kotlin-dtos.js.\n' +
    '// Nicht von Hand ändern: npm run vertrag:kotlin (im Ordner Web-App).\n' +
    '@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName")\n\n' +
    'package ch.brickinventoryapp.vertrag.erzeugt\n\n' +
    importe.map(i => `import ${i}`).join('\n') +
    '\n\n' +
    rumpf +
    '\n'
  );
}

if (require.main === module) {
  const soll = erzeuge(JSON.parse(fs.readFileSync(QUELLE, 'utf8')));
  // --pruefen schreibt nicht, es meldet nur eine Abweichung (Test und CI).
  if (process.argv.includes('--pruefen')) {
    const ist = fs.existsSync(ZIEL) ? fs.readFileSync(ZIEL, 'utf8') : '';
    if (ist !== soll) {
      console.error(`${path.relative(ROOT, ZIEL)} ist veraltet — npm run vertrag:kotlin`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(path.dirname(ZIEL), { recursive: true });
    fs.writeFileSync(ZIEL, soll);
    console.log(`geschrieben: ${path.relative(ROOT, ZIEL)}`);
  }
}

module.exports = { QUELLE, ZIEL, erzeuge };
