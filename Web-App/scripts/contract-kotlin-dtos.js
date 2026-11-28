#!/usr/bin/env node
'use strict';

/* Writes the app's Kotlin types (core-contract) from docs/openapi-v2.json, without network or Gradle:
 * responses from the schemas, bodies of the routes the app sends, one file per OpenAPI tag plus
 * test builders (testFixtures). Names and domain types: contract-kotlin-mapping.js. Checked in;
 * --pruefen only compares (exit 1 on a deviation). Call: npm run contract:kotlin */
const fs = require('node:fs');
const path = require('node:path');
const STANDARD = require('./contract-kotlin-mapping.js');

/** The mapping of the running call; tests pass a small one of their own. */
let Z = STANDARD;

const ROOT = path.join(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'docs', 'openapi-v2.json');
/** core-contract/src: the types in main, their test builders in testFixtures. */
const SOURCE_ROOT = path.join(ROOT, '..', 'Android-App', 'core-contract', 'src');
const MAIN = 'main/java/ch/brickinventoryapp/contract';
const FIXTURES = 'testFixtures/java/ch/brickinventoryapp/contract/testing';
/** Generated files are `Contract<Tag>.kt`; anything else in the folders is written by hand. */
const GENERATED = /^Contract\w*\.kt$/;
/** Shapes of no single tag (error body, shared items). */
const COMMON = 'Common';

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
  const parts = n.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let e = parts.map((t, i) => (i === 0 ? t.charAt(0).toLowerCase() : t.charAt(0).toUpperCase()) + t.slice(1)).join('');
  if (/^[0-9]/.test(e)) e = `n${e}`;
  return KEYWORDS.has(e) ? `\`${e}\`` : e;
}

/** An enumeration value as a constant. @param {string} w */
const constant = w => {
  const k = w
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return /^[0-9]/.test(k) ? `V_${k}` : k || 'EMPTY';
};

/**
 * @typedef {{ form: 'primitive', name: string } | { form: 'list', element: Typ } | { form: 'map', value: Typ }
 *   | { form: 'class', name: string }} TypeKind
 * @typedef {TypeKind & { nullable: boolean }} Typ
 * @typedef {{ json: string, ktType: Typ, required: boolean }} Feld
 * @typedef {{ name: string, fields: Feld[], enumValues?: string[], isRequest: boolean, sources: string[], tags: Set<string> }} Form
 */

/** @param {string} name @returns {Typ} */
const primitive = (name, nullable = false) => ({ form: 'primitive', name, nullable });

/** anyOf/oneOf and type lists: one type besides null stays that type (nullable), more become JsonElement.
 * @param {any[]} withoutNull @param {boolean} nullable @param {(s: any) => Typ} typeOf @returns {Typ} */
function oneOrJson(withoutNull, nullable, typeOf) {
  if (withoutNull.length !== 1) return primitive('JsonElement', nullable);
  const t = typeOf(withoutNull[0]);
  return { ...t, nullable: nullable || t.nullable };
}

/** @param {any} s @param {string} suggestion @param {(name: string, s: any) => void} beside @returns {Typ} */
function objectType(s, suggestion, beside) {
  if (s.properties && Object.keys(s.properties).length) {
    beside(suggestion, s);
    return { form: 'class', name: suggestion, nullable: false };
  }
  const value = s.additionalProperties;
  if (value && typeof value === 'object' && Object.keys(value).length) {
    const w = type(value, `${suggestion}Value`, beside);
    if (!(w.form === 'primitive' && w.name === 'JsonElement')) return { form: 'map', value: w, nullable: false };
  }
  return primitive('JsonObject');
}

/** The type of a schema; nested objects become a shape of their own [beside], raw name `<Parent><Field>` or `…Entry`.
 * @param {any} s @param {string} suggestion @param {(name: string, s: any) => void} beside @returns {Typ} */
function type(s, suggestion, beside) {
  if (!s || typeof s !== 'object' || Object.keys(s).length === 0) return primitive('JsonElement', true);
  if (s.$ref)
    return {
      form: 'class',
      name: className(s.$ref.split('/').pop()),
      nullable: false,
    };
  if (s.const !== undefined) return primitive(baseType(typeof s.const === 'number' ? 'number' : typeof s.const));
  if (s.enum)
    return primitive(s.enum.every((/** @type {unknown} */ e) => typeof e === 'string') ? 'String' : 'JsonElement');
  const branches = s.anyOf || s.oneOf;
  if (branches) {
    const withoutNull = branches.filter((/** @type {any} */ z) => z.type !== 'null');
    return oneOrJson(withoutNull, withoutNull.length < branches.length, z => type(z, suggestion, beside));
  }
  if (Array.isArray(s.type)) {
    const withoutNull = s.type.filter((/** @type {string} */ t) => t !== 'null');
    // The single type keeps the nullability of the list, not its own.
    const nullable = withoutNull.length < s.type.length;
    if (withoutNull.length === 1) return { ...type({ ...s, type: withoutNull[0] }, suggestion, beside), nullable };
    return primitive('JsonElement', nullable);
  }
  if (s.type === 'array')
    return {
      form: 'list',
      element: type(s.items, `${suggestion}Entry`, beside),
      nullable: false,
    };
  if (s.type === 'object') return objectType(s, suggestion, beside);
  // Whole numbers are counters, identifiers and quantities: Int as in the views.
  if (s.type === 'integer') return primitive('Int');
  return primitive(baseType(s.type));
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
  const n = t.nullable ? '?' : '';
  if (t.form === 'list') return `List<${kotlin(t.element)}>${n}`;
  if (t.form === 'map') return `Map<String, ${kotlin(t.value)}>${n}`;
  return `${t.name}${n}`;
}

/** Component schema names a value refers to, at any depth. @param {any} v @param {Set<string>} into */
function refs(v, into) {
  if (Array.isArray(v)) for (const x of v) refs(x, into);
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (k === '$ref' && typeof x === 'string') into.add(x.split('/').pop() ?? '');
      else refs(x, into);
    }
  return into;
}

/** The tags of the operations that use each component schema, also through other schemas. @param {any} doc @returns {Map<string, Set<string>>} */
function schemaTags(doc) {
  const schemas = doc.components?.schemas ?? {};
  /** @type {Map<string, Set<string>>} */
  const tags = new Map(Object.keys(schemas).map(n => [n, new Set()]));
  for (const op of Object.values(doc.paths ?? {}).flatMap(p => Object.values(p ?? {}))) {
    const open = [...refs(op, new Set())];
    const seen = new Set(open);
    while (open.length) {
      const n = /** @type {string} */ (open.pop());
      for (const t of op?.tags ?? []) tags.get(n)?.add(t);
      for (const m of refs(schemas[n], new Set()))
        if (!seen.has(m)) {
          seen.add(m);
          open.push(m);
        }
    }
  }
  return tags;
}

/** All shapes: component schemas and the bodies of Z.REQUESTS, raw names (before Z.NAMES); nested
 * shapes carry the tags of their schema or route. @param {any} doc @returns {Form[]} */
function collect(doc) {
  /** @type {Form[]} */
  const shapes = [];
  /** @param {string} name @param {any} s @param {boolean} isRequest @param {Set<string>} tags */
  function form(name, s, isRequest, tags) {
    const beside = (/** @type {string} */ n, /** @type {any} */ x) => form(n, x, isRequest, tags);
    if (s.enum) {
      shapes.push({
        name,
        fields: [],
        enumValues: s.enum,
        isRequest,
        sources: [name],
        tags,
      });
      return;
    }
    const mandatory = new Set(s.required ?? []);
    const fields = Object.entries(s.properties ?? {}).map(([json, schema]) => ({
      json,
      ktType: type(schema, name + className(json), beside),
      required: mandatory.has(json),
    }));
    shapes.push({ name, fields, isRequest, sources: [name], tags });
  }
  const schemas = doc.components?.schemas ?? {};
  const tags = schemaTags(doc);
  for (const n of Object.keys(schemas))
    if (!Z.OMIT.has(className(n))) form(className(n), schemas[n], false, tags.get(n) ?? new Set());
  const uniform = (/** @type {string} */ p) => p.replace(/\{\w+\}/g, '{}');
  for (const [route, name] of Object.entries(Z.REQUESTS)) {
    const [method, path] = route.split(' ');
    const op = Object.entries(doc.paths ?? {}).find(([p]) => uniform(p) === uniform(path ?? ''))?.[1];
    const o = op?.[(method ?? '').toLowerCase()];
    const s = o?.requestBody?.content?.['application/json']?.schema;
    if (!s) throw new Error(`${route}: kein Rumpf im Vertrag (contract-kotlin-mapping.js, ANFRAGEN)`);
    form(name, s, true, new Set(o.tags ?? []));
  }
  return shapes;
}

/** @param {string} n */
const endName = n => Z.NAMES[n] ?? n;

/** @param {Typ} t @returns {Typ} */
function renamed(t) {
  if (t.form === 'list') return { ...t, element: renamed(t.element) };
  if (t.form === 'map') return { ...t, value: renamed(t.value) };
  if (t.form === 'class') return { ...t, name: endName(t.name) };
  return t;
}

/** Put a domain type in the place of the innermost String (a list stays a list). @param {Typ} t @param {string} domain @returns {Typ} */
function withSlotType(t, domain) {
  if (t.form === 'list') return { ...t, element: withSlotType(t.element, domain) };
  // With an own serializer something unknown reads as null: then the field is always nullable.
  if (t.form === 'primitive' && t.name === 'String')
    return {
      ...t,
      name: domain,
      nullable: t.nullable || !!Z.DOMAIN_TYPES[domain]?.serializer,
    };
  // An open schema ({} or text|number) gets the type the app sends.
  if (t.form === 'primitive' && t.name === 'JsonElement') return { ...t, name: domain };
  throw new Error(`Fachtyp ${domain} nur an Stelle eines String (${kotlin(t)})`);
}

/** One field of two shapes of one name: a JsonElement on either side opens it, otherwise the types agree; required where both require it.
 * @param {Feld} x @param {Feld} y @param {(ky: string, kx: string) => string} clash @returns {Feld} */
function mergedField(x, y, clash) {
  const open = [x.ktType, y.ktType].some(t => t.form === 'primitive' && t.name === 'JsonElement');
  if (open) return { ...y, required: false, ktType: primitive('JsonElement', true) };
  if (kotlin({ ...x.ktType, nullable: false }) !== kotlin({ ...y.ktType, nullable: false }))
    throw new Error(clash(kotlin(y.ktType), kotlin(x.ktType)));
  return {
    ...y,
    required: y.required && x.required,
    ktType: { ...y.ktType, nullable: y.ktType.nullable || x.ktType.nullable },
  };
}

/** Shapes of one final name become one: required where all require it, nullable where one allows it.
 * @param {Form[]} shapes @returns {Map<string, Form>} */
function unite(shapes) {
  /** @type {Map<string, Form>} */
  const from = new Map();
  for (const f of shapes) {
    const name = endName(f.name);
    const fields = f.fields.map(x => {
      const domain = Z.FIELD_TYPES[`${name}.${x.json}`];
      const t = renamed(x.ktType);
      return { ...x, ktType: domain ? withSlotType(t, domain) : t };
    });
    const da = from.get(name);
    if (!da) {
      from.set(name, { ...f, name, fields });
      continue;
    }
    if (da.isRequest !== f.isRequest) throw new Error(`${name}: Anfrage und Antwort in einer Form (${f.name})`);
    if (da.enumValues || f.enumValues) throw new Error(`${name}: Aufzählung lässt sich nicht vereinen`);
    const all = new Map(da.fields.map(x => [x.json, x]));
    for (const x of fields) {
      const y = all.get(x.json);
      all.set(
        x.json,
        y
          ? mergedField(x, y, (ky, kx) => `${name}.${x.json}: ${ky} in ${da.sources.join(', ')}, ${kx} in ${f.name}`)
          : { ...x, required: false },
      );
    }
    for (const [json, y] of all) if (!fields.some(x => x.json === json)) all.set(json, { ...y, required: false });
    from.set(name, {
      ...da,
      fields: [...all.values()],
      sources: [...da.sources, f.name],
      tags: new Set([...da.tags, ...f.tags]),
    });
  }
  return from;
}

/** The empty value of an optional response field, which may be missing. @param {Typ} t @returns {string} */
function emptyValue(t) {
  if (t.nullable) return 'null';
  if (t.form === 'list') return 'emptyList()';
  if (t.form === 'map') return 'emptyMap()';
  if (t.form === 'class') return `${t.name}()`;
  const domain = Z.DOMAIN_TYPES[t.name];
  if (domain) return domain.empty;
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

/** A body field: required ones without a default; optional ones only go out when set — encodeDefaults would
 * send null, which the server reads as "delete", not "unchanged" (exceptions: Z.NULL_SEND).
 * @param {string} name @param {string} key @param {Feld} f @param {string | undefined} defaultValue */
function bodyField(name, key, f, defaultValue) {
  const t = kotlin(f.ktType);
  if (defaultValue !== undefined)
    return `val ${name}: ${Z.REQUIRED.has(key) ? kotlin({ ...f.ktType, nullable: false }) : t} = ${defaultValue}`;
  if (f.required) return `val ${name}: ${t}`;
  if (Z.REQUIRED.has(key)) return `val ${name}: ${kotlin({ ...f.ktType, nullable: false })}`;
  if (Z.NULL_SEND.has(key)) return `val ${name}: ${kotlin({ ...f.ktType, nullable: true })} = null`;
  return `@EncodeDefault(EncodeDefault.Mode.NEVER) val ${name}: ${kotlin({ ...f.ktType, nullable: true })} = null`;
}

/** A missing optional field reads as its empty value; null where Z.NULLABLE says "missing" differs from "empty"
 * or its shape has none. @param {string} kind @param {Feld} f @returns {Typ} */
function responseType(kind, f) {
  if (f.required || f.ktType.nullable) return f.ktType;
  return withoutEmptyValue(f.ktType) || Z.NULLABLE.has(`${kind}.${f.json}`)
    ? { ...f.ktType, nullable: true }
    : f.ktType;
}

/** Response shapes with a required field: they have no empty value `Form()`. */
let STRICT = new Set();
/** @param {Typ} t @returns {t is Typ & { form: 'class', name: string }} */
const withoutEmptyValue = t => t.form === 'class' && STRICT.has(t.name);

/** @param {Form} f @returns {string} */
function kind(f) {
  if (f.enumValues) {
    const values = f.enumValues.map(w => `    @SerialName(${JSON.stringify(w)}) ${constant(w)},`);
    return `@Serializable\nenum class ${f.name} {\n${values.join('\n')}\n}`;
  }
  if (!f.fields.length) return `@Serializable\nclass ${f.name}`;
  const fields = f.fields.map(x => {
    const key = `${f.name}.${x.json}`;
    const name = Z.PROPERTIES[key] ?? property(x.json);
    const defaultValue = Z.DEFAULTS[key];
    const t = responseType(f.name, x);
    // A missing required field fails reading instead of showing false, 0 or "" as if the server said so.
    if (!f.isRequest && x.required && defaultValue !== undefined)
      throw new Error(`${key}: Pflichtfeld einer Antwort mit Vorgabe (contract-kotlin-mapping.js, DEFAULTS)`);
    const decl = f.isRequest
      ? bodyField(name, key, x, defaultValue)
      : x.required
        ? `val ${name}: ${kotlin(t)}`
        : `val ${name}: ${kotlin(t)} = ${defaultValue ?? emptyValue(t)}`;
    const ser = x.ktType.form === 'primitive' ? Z.DOMAIN_TYPES[x.ktType.name]?.serializer : undefined;
    const serialWith = ser ? `@Serializable(with = ${ser.split('.').pop()}::class) ` : '';
    return `    ${serialWith}@SerialName(${JSON.stringify(x.json)}) ${decl},`;
  });
  return `@Serializable\ndata class ${f.name}(\n${fields.join('\n')}\n)`;
}

/** A test builder for a response shape with required fields: every parameter has a value, so a test names
 * only what it checks; in testFixtures, out of the app's reach. @param {Form} f @returns {string} */
function sample(f) {
  const params = f.fields.map(x => {
    const key = `${f.name}.${x.json}`;
    const name = Z.PROPERTIES[key] ?? property(x.json);
    const t = responseType(f.name, x);
    const value = withoutEmptyValue(t) && !t.nullable ? `test${t.name}()` : (Z.DEFAULTS[key] ?? emptyValue(t));
    return { name, decl: `    ${name}: ${kotlin(t)} = ${value},` };
  });
  const args = params.map(p => `    ${p.name} = ${p.name},`).join('\n');
  return `fun test${f.name}(\n${params.map(p => p.decl).join('\n')}\n): ${f.name} = ${f.name}(\n${args}\n)`;
}

/** `sets` → `Sets`; a shape of several tags or none goes to ContractCommon.kt. @param {Set<string>} tags */
const fileTag = tags => (tags.size === 1 ? className([...tags][0] ?? COMMON) : COMMON);

/** The Kotlin files: path below core-contract/src → content. @param {any} doc @param {typeof STANDARD} [mapping] @returns {Map<string, string>} */
function files(doc, mapping = STANDARD) {
  Z = mapping;
  try {
    const shapes = [...unite(collect(doc)).values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    STRICT = new Set(shapes.filter(f => !f.isRequest && f.fields.some(x => x.required)).map(f => f.name));
    /** @type {Map<string, Form[]>} */
    const byTag = new Map();
    for (const f of shapes) byTag.set(fileTag(f.tags), [...(byTag.get(fileTag(f.tags)) ?? []), f]);
    /** @type {[string, string][]} */
    const main = [...byTag.keys()].sort().map(t => [
      `${MAIN}/Contract${t}.kt`,
      file(
        shapes
          .filter(f => fileTag(f.tags) === t)
          .map(kind)
          .join('\n\n'),
      ),
    ]);
    const samples = shapes.filter(f => STRICT.has(f.name)).map(sample);
    if (samples.length)
      main.push([
        `${FIXTURES}/ContractSamples.kt`,
        file(
          samples.join('\n\n'),
          '"FunctionNaming", "LongParameterList"',
          'ch.brickinventoryapp.contract.testing',
          shapes,
        ),
      ]);
    return new Map(main);
  } finally {
    Z = STANDARD;
  }
}

/** All files as one text, in file order (tests look for declarations in it). @param {any} doc @param {typeof STANDARD} [mapping] */
const create = (doc, mapping = STANDARD) => [...files(doc, mapping).values()].join('\n');

/** Fixtures live in a `.testing` package and import the [shapes] they name. @param {string} body @param {string} [suppress] @param {string} [pkg] @param {Form[]} [shapes] @returns {string} */
function file(
  body,
  suppress = '"ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList"',
  pkg = 'ch.brickinventoryapp.contract',
  shapes = [],
) {
  const imports = shapes
    .filter(f => new RegExp(`\\b${f.name}\\b`).test(body))
    .map(f => `ch.brickinventoryapp.contract.${f.name}`);
  if (/@SerialName/.test(body)) imports.push('kotlinx.serialization.SerialName', 'kotlinx.serialization.Serializable');
  if (/@EncodeDefault/.test(body))
    imports.push('kotlinx.serialization.EncodeDefault', 'kotlinx.serialization.ExperimentalSerializationApi');
  for (const j of ['JsonElement', 'JsonNull', 'JsonObject'])
    if (new RegExp(`\\b${j}\\b`).test(body)) imports.push(`kotlinx.serialization.json.${j}`);
  for (const [n, f] of Object.entries(Z.DOMAIN_TYPES)) {
    if (new RegExp(`\\b${n}\\b`).test(body)) imports.push(f.pkg);
    if (f.serializer && body.includes(`${f.serializer.split('.').pop()}::class`)) imports.push(f.serializer);
  }
  for (const [n, pkg] of Object.entries(Z.CONSTANTS)) if (new RegExp(`= ${n}\\b`).test(body)) imports.push(pkg);
  const optIn = /@EncodeDefault/.test(body) ? '@file:OptIn(ExperimentalSerializationApi::class)\n' : '';
  return (
    '// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.\n' +
    '// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).\n' +
    `@file:Suppress(${suppress})\n` +
    optIn +
    `\npackage ${pkg}\n\n` +
    imports
      .sort()
      .map(i => `import ${i}`)
      .join('\n') +
    '\n\n' +
    body +
    '\n'
  );
}

/** The generated files now on disk, as paths below core-contract/src. @returns {string[]} */
const present = () =>
  [MAIN, FIXTURES].flatMap(d =>
    fs.existsSync(path.join(SOURCE_ROOT, d))
      ? fs
          .readdirSync(path.join(SOURCE_ROOT, d))
          .filter(n => GENERATED.test(n))
          .map(n => `${d}/${n}`)
      : [],
  );

/** Writes the files and removes generated ones the contract no longer has. @param {Map<string, string>} want */
function write(want) {
  for (const n of present()) if (!want.has(n)) fs.rmSync(path.join(SOURCE_ROOT, n));
  for (const [n, text] of want) {
    fs.mkdirSync(path.dirname(path.join(SOURCE_ROOT, n)), { recursive: true });
    fs.writeFileSync(path.join(SOURCE_ROOT, n), text);
  }
}

/** Names of the files that deviate from [want] or are left over. @param {Map<string, string>} want */
function stale(want) {
  const old = present().filter(n => !want.has(n));
  const differ = [...want].filter(([n, text]) => {
    const f = path.join(SOURCE_ROOT, n);
    return !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text;
  });
  return [...old, ...differ.map(([n]) => n)];
}

if (require.main === module) {
  const want = files(JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8')));
  // --pruefen does not write, it only reports a deviation (test and CI).
  if (process.argv.includes('--pruefen')) {
    const wrong = stale(want);
    if (wrong.length) {
      console.error(`veraltet: ${wrong.join(', ')} — npm run contract:kotlin`);
      process.exit(1);
    }
  } else {
    write(want);
    console.log(`geschrieben: ${want.size} Dateien unter ${path.relative(ROOT, SOURCE_ROOT)}`);
  }
}

module.exports = { SOURCE_FILE, SOURCE_ROOT, MAIN, create, files, write, present, collect, className };
