/**
 * The app's Kotlin types (core-contract, package vertrag) are generated from docs/openapi.json
 * and checked in — responses and bodies, one set, no hand-written types beside them.
 * If the file deviates from the contract, this test is red until `npm run vertrag:kotlin`
 * rewrites it.
 *
 * Counter-checks (measured 14.11.2026):
 *   A  in Vertrag.kt the field year_min deleted from CatalogMetaResponse → red:
 *      “the checked-in Kotlin types are generated from openapi.json”
 *   B  in the generator leerwert() without a branch for lists (always `null`) → red: “lists,
 *      references …”, “a domain type replaces …” and A
 *   C  in the generator anyOf with null no longer nullable → red: “a field with a null branch …”
 *   D  in rumpffeld() the line for Z.NULL_SEND deleted → red: “an optional
 *      body field only goes out when set …”
 *   E  in vereine() required taken from the first form instead of from all → red:
 *      “forms of the same name become one …”
 *   F  in withSlotType() the domain type not inserted (String stays) → red: “a domain type
 *      replaces the text …”
 *   G  (15.11.2026) in klasse() `|| withoutEmptyValue(t)` deleted → red: “a required field
 *      whose shape has no empty value …” and “the checked-in Kotlin types …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { create } = require('../scripts/contract-kotlin-dtos.js');

test('the checked-in Kotlin types are generated from openapi.json', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, '..', 'scripts', 'contract-kotlin-dtos.js'), '--pruefen'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stderr);
});

/** An empty mapping, overridden as needed. @param {Record<string, any>} [mehr] */
const zuordnung = (mehr = {}) => ({
  OMIT: new Set(),
  STRICT: new Set(),
  FACHTYPEN: { Zustand: { paket: 'ch.brickinventoryapp.model.domain.Zustand', leer: 'Zustand.NEU' } },
  NAMEN: {},
  FIELD_TYPES: {},
  DEFAULTS: {},
  PROPERTIES: {},
  CONSTANTS: {},
  NULLBAR: new Set(),
  PFLICHT: new Set(),
  NULL_SEND: new Set(),
  ANFRAGEN: {},
  ...mehr,
});

/** The Kotlin file from a mini contract. @param {Record<string, any>} schemas @param {Record<string, any>} [z] @param {any} [paths] */
const aus = (schemas, z, paths = {}) => create({ components: { schemas }, paths }, /** @type {any} */ (zuordnung(z)));

test('every response field has a default: empty value, null only with a null branch', () => {
  const kt = aus({
    Probe: {
      type: 'object',
      properties: { set_number: { type: 'string' }, name: { type: 'string' }, menge: { type: 'integer' } },
      required: ['set_number'],
    },
  });
  assert.match(kt, /@SerialName\("set_number"\) val setNumber: String = "",/);
  assert.match(kt, /@SerialName\("name"\) val name: String = "",/);
  assert.match(kt, /@SerialName\("menge"\) val menge: Int = 0,/);
  const nullbar = aus(
    { Probe: { type: 'object', properties: { name: { type: 'string' } } } },
    {
      NULLBAR: new Set(['Probe.name']),
    },
  );
  assert.match(nullbar, /val name: String\? = null,/, 'Z.NULLBAR: fehlt heisst null');
});

test('a required field whose shape has no empty value gets no default', () => {
  const kt = aus(
    {
      Konto: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      Probe: {
        type: 'object',
        properties: { user: { $ref: '#/components/schemas/Konto' }, alt: { $ref: '#/components/schemas/Konto' } },
        required: ['user'],
      },
    },
    { STRICT: new Set(['Konto.id']) },
  );
  assert.match(kt, /val user: Konto,/, 'Konto() gäbe es nicht: Konto hat ein Pflichtfeld ohne Vorgabe');
  assert.match(kt, /val alt: Konto\? = null,/);
});

test('a field with a null branch is nullable', () => {
  const kt = aus({
    Probe: {
      type: 'object',
      properties: { jahr: { anyOf: [{ type: 'integer', minimum: 0, maximum: 3000 }, { type: 'null' }] } },
      required: ['jahr'],
    },
  });
  assert.match(kt, /val jahr: Int\? = null,/);
});

test('lists, references and nested objects get their type', () => {
  const kt = aus({
    set_item: { type: 'object', properties: { n: { type: 'string' } } },
    Probe: {
      type: 'object',
      properties: {
        sets: { type: 'array', items: { $ref: '#/components/schemas/set_item' } },
        seite: { type: 'object', properties: { nummer: { type: 'integer' } }, required: ['nummer'] },
      },
      required: ['sets', 'seite'],
    },
  });
  assert.match(kt, /val sets: List<SetItem> = emptyList\(\),/);
  assert.match(kt, /val seite: ProbeSeite = ProbeSeite\(\),/);
  assert.match(kt, /data class ProbeSeite\(\n {4}@SerialName\("nummer"\) val nummer: Int = 0,/);
});

test('a domain type replaces the text, list and nullability stay', () => {
  const kt = aus(
    {
      Probe: {
        type: 'object',
        properties: { condition: { type: 'string' }, conditions: { type: 'array', items: { type: 'string' } } },
        required: ['condition', 'conditions'],
      },
    },
    { FIELD_TYPES: { 'Probe.condition': 'Zustand', 'Probe.conditions': 'Zustand' } },
  );
  assert.match(kt, /val condition: Zustand = Zustand\.NEU,/);
  assert.match(kt, /val conditions: List<Zustand> = emptyList\(\),/);
  assert.match(kt, /^import ch\.brickinventoryapp\.model\.domain\.Zustand$/m);
});

test('shapes with the same name become one: fields merged, required only where all require it', () => {
  const kt = aus(
    {
      A: {
        type: 'object',
        properties: { id: { type: 'integer' }, nur_a: { type: 'string' } },
        required: ['id', 'nur_a'],
      },
      B: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    { NAMEN: { A: 'Konto', B: 'Konto' } },
  );
  assert.equal((kt.match(/data class Konto\(/g) ?? []).length, 1);
  assert.match(kt, /val id: Int = 0,/);
  assert.match(kt, /val nurA: String = "",/);
  const rumpf = aus(
    {},
    { ANFRAGEN: { 'POST /a': 'Rumpf', 'PUT /b/{id}': 'Rumpf' } },
    {
      '/a': { post: { requestBody: bodySchema({ x: { type: 'string' }, y: { type: 'string' } }, ['x', 'y']) } },
      '/b/{nr}': { put: { requestBody: bodySchema({ x: { type: 'string' }, y: { type: 'string' } }, ['y']) } },
    },
  );
  assert.match(rumpf, /val y: String,/, 'y verlangen beide Routen');
  assert.match(rumpf, /@EncodeDefault\(EncodeDefault\.Mode\.NEVER\) val x: String\? = null,/, 'x nur eine');
});

/** @param {Record<string, any>} properties @param {string[]} [required] */
function bodySchema(properties, required = []) {
  return { content: { 'application/json': { schema: { type: 'object', properties, required } } } };
}

test('an optional body field only goes out when set, unless it should say null', () => {
  const paths = {
    '/r': {
      put: {
        requestBody: bodySchema({
          menge: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] },
          lagerort: { type: ['string', 'null'] },
          name: { type: 'string' },
        }),
      },
    },
  };
  const kt = aus(
    {},
    {
      ANFRAGEN: { 'PUT /r': 'Aenderung' },
      FIELD_TYPES: { 'Aenderung.menge': 'Int' },
      NULL_SEND: new Set(['Aenderung.lagerort']),
      PFLICHT: new Set(['Aenderung.name']),
    },
    paths,
  );
  assert.match(kt, /@EncodeDefault\(EncodeDefault\.Mode\.NEVER\) val menge: Int\? = null,/);
  assert.match(kt, /@SerialName\("lagerort"\) val lagerort: String\? = null,/, 'null heisst beim Server leeren');
  assert.match(kt, /@SerialName\("name"\) val name: String,/, 'Z.PFLICHT: immer gesetzt');
  assert.match(kt, /^@file:OptIn\(ExperimentalSerializationApi::class\)$/m);
});
