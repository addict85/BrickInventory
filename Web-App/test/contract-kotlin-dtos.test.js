/**
 * The app's Kotlin types (core-contract, package contract) are generated from docs/openapi-v2.json
 * and checked in — responses and bodies, one set, no hand-written types beside them.
 * If the file deviates from the contract, this test is red until `npm run contract:kotlin`
 * rewrites it.
 *
 * Counter-checks (measured 14.11.2026):
 *   A  in Contract.kt the field year_min deleted from CatalogMetaResponse → red:
 *      “the checked-in Kotlin types are generated from openapi-v2.json”
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
 *   H  (28.11.2026) in kind() a required response field again `= emptyValue(t)` → red: “a required
 *      response field has no default …”, “lists, references …” and the checked-in check
 *   I  in kind() the refusal of DEFAULTS for required fields deleted → red: “a default for a
 *      required response field is refused”
 *   J  in fileTag() always the first tag instead of Common → red: “one file per tag …”
 *   K  in sample() the class default `test${t.name}()` replaced by emptyValue(t) → red: “a response
 *      shape with required fields gets a test builder …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { create, files } = require('../scripts/contract-kotlin-dtos.js');

test('the checked-in Kotlin types are generated from openapi-v2.json', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, '..', 'scripts', 'contract-kotlin-dtos.js'), '--pruefen'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stderr);
});

/** An empty mapping, overridden as needed. @param {Record<string, any>} [more] */
const mapping = (more = {}) => ({
  OMIT: new Set(),
  DOMAIN_TYPES: { Condition: { pkg: 'ch.brickinventoryapp.model.domain.Condition', empty: 'Condition.NEU' } },
  NAMES: {},
  FIELD_TYPES: {},
  DEFAULTS: {},
  PROPERTIES: {},
  CONSTANTS: {},
  NULLABLE: new Set(),
  REQUIRED: new Set(),
  NULL_SEND: new Set(),
  REQUESTS: {},
  ...more,
});

/** The Kotlin file from a mini contract. @param {Record<string, any>} schemas @param {Record<string, any>} [z] @param {any} [paths] */
const out = (schemas, z, paths = {}) => create({ components: { schemas }, paths }, /** @type {any} */ (mapping(z)));

test('a required response field has no default, an optional one reads as its empty value', () => {
  const kt = out({
    Probe: {
      type: 'object',
      properties: { set_number: { type: 'string' }, name: { type: 'string' }, quantity: { type: 'integer' } },
      required: ['set_number'],
    },
  });
  assert.match(kt, /@SerialName\("set_number"\) val setNumber: String,/);
  assert.match(kt, /@SerialName\("name"\) val name: String = "",/);
  assert.match(kt, /@SerialName\("quantity"\) val quantity: Int = 0,/);
  const nullable = out(
    { Probe: { type: 'object', properties: { name: { type: 'string' } } } },
    {
      NULLABLE: new Set(['Probe.name']),
    },
  );
  assert.match(nullable, /val name: String\? = null,/, 'NULLABLE: missing means null');
});

test('an optional field of a shape with required fields is null when missing', () => {
  const kt = out({
    Account: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    Probe: {
      type: 'object',
      properties: { user: { $ref: '#/components/schemas/Account' }, alt: { $ref: '#/components/schemas/Account' } },
      required: ['user'],
    },
  });
  assert.match(kt, /val user: Account,/);
  assert.match(
    kt,
    /val alt: Account\? = null,/,
    'Account() would not exist: Account has a required field without a default',
  );
});

test('a default for a required response field is refused', () => {
  const schemas = { Probe: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } };
  assert.throws(
    () => out(schemas, { DEFAULTS: { 'Probe.n': '1' } }),
    /Probe\.n: Pflichtfeld einer Antwort mit Vorgabe/,
  );
  assert.match(out(schemas, { DEFAULTS: {} }), /val n: Int,/);
});

test('a field with a null branch is nullable', () => {
  const kt = out({
    Probe: {
      type: 'object',
      properties: { year: { anyOf: [{ type: 'integer', minimum: 0, maximum: 3000 }, { type: 'null' }] } },
      required: ['year'],
    },
  });
  assert.match(kt, /val year: Int\?,/, 'required: the key must be there, its value may be null');
});

test('lists, references and nested objects get their type', () => {
  const kt = out({
    set_item: { type: 'object', properties: { n: { type: 'string' } } },
    Probe: {
      type: 'object',
      properties: {
        sets: { type: 'array', items: { $ref: '#/components/schemas/set_item' } },
        page: { type: 'object', properties: { number: { type: 'integer' } }, required: ['number'] },
      },
      required: ['sets', 'page'],
    },
  });
  assert.match(kt, /val sets: List<SetItem>,/);
  assert.match(kt, /val page: ProbePage,/);
  assert.match(kt, /data class ProbePage\(\n {4}@SerialName\("number"\) val number: Int,/);
});

test('a domain type replaces the text, list and nullability stay', () => {
  const kt = out(
    {
      Probe: {
        type: 'object',
        properties: { condition: { type: 'string' }, conditions: { type: 'array', items: { type: 'string' } } },
        required: ['condition', 'conditions'],
      },
    },
    { FIELD_TYPES: { 'Probe.condition': 'Condition', 'Probe.conditions': 'Condition' } },
  );
  assert.match(kt, /val condition: Condition,/);
  assert.match(kt, /val conditions: List<Condition>,/);
  assert.match(kt, /^import ch\.brickinventoryapp\.model\.domain\.Condition$/m);
});

test('shapes with the same name become one: fields merged, required only where all require it', () => {
  const kt = out(
    {
      A: {
        type: 'object',
        properties: { id: { type: 'integer' }, only_a: { type: 'string' } },
        required: ['id', 'only_a'],
      },
      B: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    },
    { NAMES: { A: 'Account', B: 'Account' } },
  );
  assert.equal((kt.match(/data class Account\(/g) ?? []).length, 1);
  assert.match(kt, /val id: Int,/, 'both require id');
  assert.match(kt, /val onlyA: String = "",/, 'only A requires only_a');
  const body = out(
    {},
    { REQUESTS: { 'POST /a': 'Rumpf', 'PUT /b/{id}': 'Rumpf' } },
    {
      '/a': { post: { requestBody: bodySchema({ x: { type: 'string' }, y: { type: 'string' } }, ['x', 'y']) } },
      '/b/{nr}': { put: { requestBody: bodySchema({ x: { type: 'string' }, y: { type: 'string' } }, ['y']) } },
    },
  );
  assert.match(body, /val y: String,/, 'both routes require y');
  assert.match(body, /@EncodeDefault\(EncodeDefault\.Mode\.NEVER\) val x: String\? = null,/, 'only one requires x');
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
          quantity: { anyOf: [{ type: 'integer' }, { type: 'string' }, { type: 'null' }] },
          storage: { type: ['string', 'null'] },
          name: { type: 'string' },
        }),
      },
    },
  };
  const kt = out(
    {},
    {
      REQUESTS: { 'PUT /r': 'Aenderung' },
      FIELD_TYPES: { 'Aenderung.quantity': 'Int' },
      NULL_SEND: new Set(['Aenderung.storage']),
      REQUIRED: new Set(['Aenderung.name']),
    },
    paths,
  );
  assert.match(kt, /@EncodeDefault\(EncodeDefault\.Mode\.NEVER\) val quantity: Int\? = null,/);
  assert.match(kt, /@SerialName\("storage"\) val storage: String\? = null,/, 'null means clear on the server');
  assert.match(kt, /@SerialName\("name"\) val name: String,/, 'REQUIRED: always set');
  assert.match(kt, /^@file:OptIn\(ExperimentalSerializationApi::class\)$/m);
});

test('one file per tag; a shape of several tags goes to the common file', () => {
  const ref = (/** @type {string} */ n) => ({
    responses: { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${n}` } } } } },
  });
  const schemas = {
    SetRow: { type: 'object', properties: { n: { type: 'string' } } },
    PartRow: { type: 'object', properties: { owner: { $ref: '#/components/schemas/Owner' } } },
    Owner: { type: 'object', properties: { id: { type: 'integer' } } },
  };
  const paths = {
    '/sets': { get: { tags: ['sets'], ...ref('SetRow') } },
    '/parts': { get: { tags: ['parts'], ...ref('PartRow') } },
    '/owners': { get: { tags: ['household'], ...ref('Owner') } },
  };
  const f = files({ components: { schemas }, paths }, /** @type {any} */ (mapping()));
  const at = (/** @type {RegExp} */ name) => [...f].find(([k]) => name.test(k))?.[1] ?? '';
  assert.match(at(/^main\/.*\/ContractSets\.kt$/), /data class SetRow\(/);
  assert.match(at(/^main\/.*\/ContractParts\.kt$/), /data class PartRow\(/);
  assert.match(
    at(/^main\/.*\/ContractCommon\.kt$/),
    /data class Owner\(/,
    'parts reach Owner through PartRow, household directly',
  );
  assert.doesNotMatch(at(/^main\/.*\/ContractParts\.kt$/), /class Owner\(/);
});

test('a response shape with required fields gets a test builder with values for all of them', () => {
  const f = files(
    {
      components: {
        schemas: {
          Account: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
          Probe: {
            type: 'object',
            properties: { user: { $ref: '#/components/schemas/Account' }, name: { type: 'string' } },
            required: ['user'],
          },
        },
      },
      paths: {},
    },
    /** @type {any} */ (mapping()),
  );
  const kt = [...f].find(([k]) => /^testFixtures\/.*\/testing\/ContractSamples\.kt$/.test(k))?.[1] ?? '';
  assert.match(
    kt,
    /fun testProbe\(\n {4}user: Account = testAccount\(\),\n {4}name: String = "",\n\): Probe = Probe\(/,
  );
  assert.match(kt, /fun testAccount\(\n {4}id: Int = 0,/);
});
