#!/usr/bin/env node
'use strict';

/**
 * Writes the app's Kotlin types (core-contract, package vertrag) from
 * docs/openapi.json, without network and without Gradle: responses from the schemas,
 * bodies from the requests of the routes the app sends. Names and domain types
 * are in contract-kotlin-mapping.js. Checked in; with --pruefen only
 * compare (return 1 on a deviation). Call: npm run vertrag:kotlin
 */
const fs = require('node:fs');
const path = require('node:path');
const STANDARD = require('./contract-kotlin-mapping.js');

/** The mapping of the running call; tests pass a small one of their own. */
let Z = STANDARD;

const ROOT = path.join(__dirname, '..');
const QUELLE = path.join(ROOT, 'docs', 'openapi.json');
const ZIEL = path.join(
  ROOT,
  '..',
  'Android-App',
  'core-contract',
  'src',
  'main',
  'java',
  'ch',
  'brickinventoryapp',
  'contract',
  'Vertrag.kt',
);

const KEYWORDS = new Set([
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

/** A schema name as a Kotlin class name: word parts capitalized, without underscores. @param {string} n */
const className = n =>
  n
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(t => t.charAt(0).toUpperCase() + t.slice(1))
    .join('');

/** A JSON field name as a Kotlin property (snake_case → camelCase). @param {string} n */
function property(n) {
  const teile = n.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let e = teile.map((t, i) => (i === 0 ? t.charAt(0).toLowerCase() : t.charAt(0).toUpperCase()) + t.slice(1)).join('');
  if (/^[0-9]/.test(e)) e = `n${e}`;
  return KEYWORDS.has(e) ? `\`${e}\`` : e;
}

/** An enumeration value as a constant. @param {string} w */
const constant = w => {
  const k = w
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /^[0-9]/.test(k) ? `W_${k}` : k || 'LEER';
};

/**
 * @typedef {{ art: 'grund', name: string } | { art: 'liste', element: Typ } | { art: 'karte', wert: Typ }
 *   | { art: 'klasse', name: string }} TypeKind
 * @typedef {TypeKind & { nullbar: boolean }} Typ
 * @typedef {{ json: string, typ: Typ, pflicht: boolean }} Feld
 * @typedef {{ name: string, felder: Feld[], werte?: string[], anfrage: boolean, quellen: string[] }} Form
 */

/** @param {string} name @returns {Typ} */
const grund = (name, nullbar = false) => ({ art: 'grund', name, nullbar });

/**
 * The type of a schema; nested objects are collected as a shape of their own [neben],
 * under the raw name `<Parent><Field>` or `…Eintrag`.
 * @param {any} s @param {string} vorschlag @param {(name: string, s: any) => void} neben @returns {Typ}
 */
function typ(s, vorschlag, neben) {
  if (!s || typeof s !== 'object' || Object.keys(s).length === 0) return grund('JsonElement', true);
  if (s.$ref)
    return {
      art: 'klasse',
      name: className(s.$ref.split('/').pop()),
      nullbar: false,
    };
  if (s.const !== undefined) return grund(baseType(typeof s.const === 'number' ? 'number' : typeof s.const));
  if (s.enum)
    return grund(s.enum.every((/** @type {unknown} */ e) => typeof e === 'string') ? 'String' : 'JsonElement');
  const zweige = s.anyOf || s.oneOf;
  if (zweige) {
    const withoutNull = zweige.filter((/** @type {any} */ z) => z.type !== 'null');
    const nullbar = withoutNull.length < zweige.length;
    if (withoutNull.length === 1) {
      const t = typ(withoutNull[0], vorschlag, neben);
      return { ...t, nullbar: nullbar || t.nullbar };
    }
    return grund('JsonElement', nullbar);
  }
  if (Array.isArray(s.type)) {
    const withoutNull = s.type.filter((/** @type {string} */ t) => t !== 'null');
    const nullbar = withoutNull.length < s.type.length;
    if (withoutNull.length === 1) return { ...typ({ ...s, type: withoutNull[0] }, vorschlag, neben), nullbar };
    return grund('JsonElement', nullbar);
  }
  if (s.type === 'array')
    return {
      art: 'liste',
      element: typ(s.items, `${vorschlag}Eintrag`, neben),
      nullbar: false,
    };
  if (s.type === 'object') {
    if (s.properties && Object.keys(s.properties).length) {
      neben(vorschlag, s);
      return { art: 'klasse', name: vorschlag, nullbar: false };
    }
    const wert = s.additionalProperties;
    if (wert && typeof wert === 'object' && Object.keys(wert).length) {
      const w = typ(wert, `${vorschlag}Wert`, neben);
      if (!(w.art === 'grund' && w.name === 'JsonElement')) return { art: 'karte', wert: w, nullbar: false };
    }
    return grund('JsonObject');
  }
  // Whole numbers are counters, identifiers and quantities: Int as in the views.
  if (s.type === 'integer') return grund('Int');
  return grund(baseType(s.type));
}

/** @param {string} t */
function baseType(t) {
  return (
    {
      string: 'String',
      number: 'Double',
      boolean: 'Boolean',
      null: 'JsonElement',
    }[t] ?? 'JsonElement'
  );
}

/** @param {Typ} t @returns {string} */
function kotlin(t) {
  const n = t.nullbar ? '?' : '';
  if (t.art === 'liste') return `List<${kotlin(t.element)}>${n}`;
  if (t.art === 'karte') return `Map<String, ${kotlin(t.wert)}>${n}`;
  return `${t.name}${n}`;
}

/**
 * Collects all shapes: the schemas under components and the bodies of the
 * requests from Z.ANFRAGEN. Names are still raw (before Z.NAMEN).
 * @param {any} dok @returns {Form[]}
 */
function collect(dok) {
  /** @type {Form[]} */
  const shapes = [];
  /** @param {string} name @param {any} s @param {boolean} anfrage */
  function form(name, s, anfrage) {
    const neben = (/** @type {string} */ n, /** @type {any} */ x) => form(n, x, anfrage);
    if (s.enum) {
      shapes.push({
        name,
        felder: [],
        werte: s.enum,
        anfrage,
        quellen: [name],
      });
      return;
    }
    const pflicht = new Set(s.required ?? []);
    const felder = Object.entries(s.properties ?? {}).map(([json, schema]) => ({
      json,
      typ: typ(schema, name + className(json), neben),
      pflicht: pflicht.has(json),
    }));
    shapes.push({ name, felder, anfrage, quellen: [name] });
  }
  const schemas = dok.components?.schemas ?? {};
  for (const n of Object.keys(schemas)) if (!Z.OMIT.has(className(n))) form(className(n), schemas[n], false);
  const uniform = (/** @type {string} */ p) => p.replace(/\{\w+\}/g, '{}');
  for (const [route, name] of Object.entries(Z.ANFRAGEN)) {
    const [methode, pfad] = route.split(' ');
    const op = Object.entries(dok.paths ?? {}).find(([p]) => uniform(p) === uniform(pfad ?? ''))?.[1];
    const s = op?.[(methode ?? '').toLowerCase()]?.requestBody?.content?.['application/json']?.schema;
    if (!s) throw new Error(`${route}: kein Rumpf im Vertrag (contract-kotlin-mapping.js, ANFRAGEN)`);
    form(name, s, true);
  }
  return shapes;
}

/** @param {string} n */
const endname = n => Z.NAMEN[n] ?? n;

/** @param {Typ} t @returns {Typ} */
function umbenannt(t) {
  if (t.art === 'liste') return { ...t, element: umbenannt(t.element) };
  if (t.art === 'karte') return { ...t, wert: umbenannt(t.wert) };
  if (t.art === 'klasse') return { ...t, name: endname(t.name) };
  return t;
}

/** Put a domain type in the place of the innermost String (a list stays a list). @param {Typ} t @param {string} fach @returns {Typ} */
function withSlotType(t, fach) {
  if (t.art === 'liste') return { ...t, element: withSlotType(t.element, fach) };
  // With an own serializer something unknown reads as null: then the field is always nullable.
  if (t.art === 'grund' && t.name === 'String')
    return {
      ...t,
      name: fach,
      nullbar: t.nullbar || !!Z.FACHTYPEN[fach]?.serializer,
    };
  // An open schema ({} or text|number) gets the type the app sends.
  if (t.art === 'grund' && t.name === 'JsonElement') return { ...t, name: fach };
  throw new Error(`Fachtyp ${fach} nur an Stelle eines String (${kotlin(t)})`);
}

/**
 * Shapes with the same final name become one: fields merged, required only where all of them
 * require it, nullable where one allows it; the same name means the same type.
 * @param {Form[]} shapes @returns {Map<string, Form>}
 */
function unite(shapes) {
  /** @type {Map<string, Form>} */
  const aus = new Map();
  for (const f of shapes) {
    const name = endname(f.name);
    const felder = f.felder.map(x => {
      const fach = Z.FIELD_TYPES[`${name}.${x.json}`];
      const t = umbenannt(x.typ);
      return { ...x, typ: fach ? withSlotType(t, fach) : t };
    });
    const da = aus.get(name);
    if (!da) {
      aus.set(name, { ...f, name, felder });
      continue;
    }
    if (da.anfrage !== f.anfrage) throw new Error(`${name}: Anfrage und Antwort in einer Form (${f.name})`);
    if (da.werte || f.werte) throw new Error(`${name}: Aufzählung lässt sich nicht vereinen`);
    const alle = new Map(da.felder.map(x => [x.json, x]));
    for (const x of felder) {
      const y = alle.get(x.json);
      if (!y) {
        alle.set(x.json, { ...x, pflicht: false });
        continue;
      }
      const offen = [x.typ, y.typ].some(t => t.art === 'grund' && t.name === 'JsonElement');
      if (offen) {
        alle.set(x.json, {
          ...y,
          pflicht: false,
          typ: grund('JsonElement', true),
        });
        continue;
      }
      if (kotlin({ ...x.typ, nullbar: false }) !== kotlin({ ...y.typ, nullbar: false }))
        throw new Error(
          `${name}.${x.json}: ${kotlin(y.typ)} in ${da.quellen.join(', ')}, ${kotlin(x.typ)} in ${f.name}`,
        );
      alle.set(x.json, {
        ...y,
        pflicht: y.pflicht && x.pflicht,
        typ: { ...y.typ, nullbar: y.typ.nullbar || x.typ.nullbar },
      });
    }
    for (const [json, y] of alle) if (!felder.some(x => x.json === json)) alle.set(json, { ...y, pflicht: false });
    aus.set(name, {
      ...da,
      felder: [...alle.values()],
      quellen: [...da.quellen, f.name],
    });
  }
  return aus;
}

/**
 * The empty value of a response field. Every field has one: an older server
 * lacking a new field, and a stored older response, stay readable.
 * @param {Typ} t @returns {string}
 */
function emptyValue(t) {
  if (t.nullbar) return 'null';
  if (t.art === 'liste') return 'emptyList()';
  if (t.art === 'karte') return 'emptyMap()';
  if (t.art === 'klasse') return `${t.name}()`;
  const fach = Z.FACHTYPEN[t.name];
  if (fach) return fach.leer;
  return (
    /** @type {Record<string, string>} */ ({
      String: '""',
      Int: '0',
      Double: '0.0',
      Boolean: 'false',
      JsonObject: 'JsonObject(emptyMap())',
      JsonElement: 'JsonNull',
    })[t.name] ?? 'null'
  );
}

/**
 * A body field: required fields without a default (the caller names them), optional ones
 * only go out if they are set — encodeDefaults would otherwise send null,
 * and the server would read "delete" instead of "unchanged" (exceptions: Z.NULL_SEND).
 * @param {string} name @param {string} schluessel @param {Feld} f @param {string | undefined} vorgabe
 */
function rumpffeld(name, schluessel, f, vorgabe) {
  const t = kotlin(f.typ);
  if (vorgabe !== undefined)
    return `val ${name}: ${Z.PFLICHT.has(schluessel) ? kotlin({ ...f.typ, nullbar: false }) : t} = ${vorgabe}`;
  if (f.pflicht) return `val ${name}: ${t}`;
  if (Z.PFLICHT.has(schluessel)) return `val ${name}: ${kotlin({ ...f.typ, nullbar: false })}`;
  if (Z.NULL_SEND.has(schluessel)) return `val ${name}: ${kotlin({ ...f.typ, nullbar: true })} = null`;
  return `@EncodeDefault(EncodeDefault.Mode.NEVER) val ${name}: ${kotlin({ ...f.typ, nullbar: true })} = null`;
}

/**
 * A response field that may be missing reads as the empty value, unless it is in
 * Z.NULLBAR: there "missing" means something different from "empty".
 * @param {string} klasse @param {Feld} f @returns {Typ}
 */
function antworttyp(klasse, f) {
  if (f.pflicht || f.typ.nullbar) return f.typ;
  const withoutEmptyValue = f.typ.art === 'klasse' && STRICT.has(f.typ.name);
  return withoutEmptyValue || Z.NULLBAR.has(`${klasse}.${f.json}`) ? { ...f.typ, nullbar: true } : f.typ;
}

/** Response shapes with required fields: they have no empty value `Form()`. */
let STRICT = new Set();
/** A required field of such a shape gets no default; the caller names it. @param {Typ} t */
const withoutEmptyValue = t => t.art === 'klasse' && !t.nullbar && STRICT.has(t.name);

/** @param {Form} f @returns {string} */
function klasse(f) {
  if (f.werte) {
    const werte = f.werte.map(w => `    @SerialName(${JSON.stringify(w)}) ${constant(w)},`);
    return `@Serializable\nenum class ${f.name} {\n${werte.join('\n')}\n}`;
  }
  if (!f.felder.length) return `@Serializable\nclass ${f.name}`;
  const felder = f.felder.map(x => {
    const schluessel = `${f.name}.${x.json}`;
    const name = Z.PROPERTIES[schluessel] ?? property(x.json);
    const vorgabe = Z.DEFAULTS[schluessel];
    const t = antworttyp(f.name, x);
    const decl = f.anfrage
      ? rumpffeld(name, schluessel, x, vorgabe)
      : x.pflicht && vorgabe === undefined && (Z.STRICT.has(schluessel) || withoutEmptyValue(t))
        ? `val ${name}: ${kotlin(t)}`
        : `val ${name}: ${kotlin(t)} = ${vorgabe ?? emptyValue(t)}`;
    const ser = x.typ.art === 'grund' ? Z.FACHTYPEN[x.typ.name]?.serializer : undefined;
    const mit = ser ? `@Serializable(with = ${ser.split('.').pop()}::class) ` : '';
    return `    ${mit}@SerialName(${JSON.stringify(x.json)}) ${decl},`;
  });
  return `@Serializable\ndata class ${f.name}(\n${felder.join('\n')}\n)`;
}

/**
 * The Kotlin file from the OpenAPI document.
 * @param {any} dok @param {typeof STANDARD} [zuordnung] @returns {string}
 */
function create(dok, zuordnung = STANDARD) {
  Z = zuordnung;
  try {
    return datei(dok);
  } finally {
    Z = STANDARD;
  }
}

/** @param {any} dok @returns {string} */
function datei(dok) {
  const shapes = [...unite(collect(dok)).values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  STRICT = new Set(
    shapes
      .filter(f => !f.anfrage && f.felder.some(x => x.pflicht && Z.STRICT.has(`${f.name}.${x.json}`)))
      .map(f => f.name),
  );
  const rumpf = shapes.map(klasse).join('\n\n');
  const importe = ['kotlinx.serialization.SerialName', 'kotlinx.serialization.Serializable'];
  if (/@EncodeDefault/.test(rumpf))
    importe.push('kotlinx.serialization.EncodeDefault', 'kotlinx.serialization.ExperimentalSerializationApi');
  for (const j of ['JsonElement', 'JsonNull', 'JsonObject'])
    if (new RegExp(`\\b${j}\\b`).test(rumpf)) importe.push(`kotlinx.serialization.json.${j}`);
  for (const [n, f] of Object.entries(Z.FACHTYPEN)) {
    if (new RegExp(`\\b${n}\\b`).test(rumpf)) importe.push(f.paket);
    if (f.serializer && rumpf.includes(`${f.serializer.split('.').pop()}::class`)) importe.push(f.serializer);
  }
  for (const [n, paket] of Object.entries(Z.CONSTANTS)) if (new RegExp(`= ${n}\\b`).test(rumpf)) importe.push(paket);
  const optIn = /@EncodeDefault/.test(rumpf) ? '@file:OptIn(ExperimentalSerializationApi::class)\n' : '';
  return (
    '// Generated from Web-App/docs/openapi.json by Web-App/scripts/contract-kotlin-dtos.js.\n' +
    '// Do not edit by hand: npm run vertrag:kotlin (in the Web-App folder).\n' +
    '@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")\n' +
    optIn +
    '\npackage ch.brickinventoryapp.contract\n\n' +
    importe
      .sort()
      .map(i => `import ${i}`)
      .join('\n') +
    '\n\n' +
    rumpf +
    '\n'
  );
}

if (require.main === module) {
  const soll = create(JSON.parse(fs.readFileSync(QUELLE, 'utf8')));
  // --pruefen does not write, it only reports a deviation (test and CI).
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

module.exports = { QUELLE, ZIEL, create, collect, className };
