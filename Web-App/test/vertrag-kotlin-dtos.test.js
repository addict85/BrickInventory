/**
 * Die Kotlin-Typen der App (core-vertrag, Paket vertrag) sind aus docs/openapi.json
 * erzeugt und eingecheckt — Antworten und Rümpfe, ein Satz, keine Handtypen daneben.
 * Weicht die Datei vom Vertrag ab, ist dieser Test rot, bis `npm run vertrag:kotlin`
 * sie neu schreibt.
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  in Vertrag.kt bei CatalogMetaResponse das Feld year_min gestrichen → rot:
 *      „die eingecheckten Kotlin-Typen sind aus openapi.json erzeugt“
 *   B  im Erzeuger leerwert() ohne Zweig für Listen (immer `null`) → rot: „Listen,
 *      Verweise …“, „ein Fachtyp ersetzt …“ und A
 *   C  im Erzeuger anyOf mit null nicht mehr nullbar → rot: „ein Feld mit null-Zweig …“
 *   D  in rumpffeld() die Zeile für Z.NULL_SENDEN gestrichen → rot: „ein freiwilliges
 *      Rumpffeld geht nur gesetzt hinaus …“
 *   E  in vereine() Pflicht aus der ersten Form übernommen statt aus allen → rot:
 *      „gleichnamige Formen werden eine …“
 *   F  in mitFachtyp() den Fachtyp nicht eingesetzt (String bleibt) → rot: „ein Fachtyp
 *      ersetzt den Text …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { erzeuge } = require('../scripts/vertrag-kotlin-dtos.js');

test('die eingecheckten Kotlin-Typen sind aus openapi.json erzeugt', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, '..', 'scripts', 'vertrag-kotlin-dtos.js'), '--pruefen'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stderr);
});

/** Eine leere Zuordnung, nach Bedarf überschrieben. @param {Record<string, any>} [mehr] */
const zuordnung = (mehr = {}) => ({
  AUSLASSEN: new Set(),
  STRENG: new Set(),
  FACHTYPEN: { Zustand: { paket: 'ch.brickinventoryapp.model.fach.Zustand', leer: 'Zustand.NEU' } },
  NAMEN: {},
  FELDTYPEN: {},
  VORGABEN: {},
  EIGENSCHAFTEN: {},
  KONSTANTEN: {},
  NULLBAR: new Set(),
  PFLICHT: new Set(),
  NULL_SENDEN: new Set(),
  ANFRAGEN: {},
  ...mehr,
});

/** Die Kotlin-Datei aus einem Mini-Vertrag. @param {Record<string, any>} schemas @param {Record<string, any>} [z] @param {any} [paths] */
const aus = (schemas, z, paths = {}) => erzeuge({ components: { schemas }, paths }, /** @type {any} */ (zuordnung(z)));

test('jedes Antwortfeld hat eine Vorgabe: Leerwert, null nur mit null-Zweig', () => {
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

test('ein Feld mit null-Zweig ist nullbar', () => {
  const kt = aus({
    Probe: {
      type: 'object',
      properties: { jahr: { anyOf: [{ type: 'integer', minimum: 0, maximum: 3000 }, { type: 'null' }] } },
      required: ['jahr'],
    },
  });
  assert.match(kt, /val jahr: Int\? = null,/);
});

test('Listen, Verweise und verschachtelte Objekte bekommen ihren Typ', () => {
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

test('ein Fachtyp ersetzt den Text, Liste und Nullbarkeit bleiben', () => {
  const kt = aus(
    {
      Probe: {
        type: 'object',
        properties: { condition: { type: 'string' }, conditions: { type: 'array', items: { type: 'string' } } },
        required: ['condition', 'conditions'],
      },
    },
    { FELDTYPEN: { 'Probe.condition': 'Zustand', 'Probe.conditions': 'Zustand' } },
  );
  assert.match(kt, /val condition: Zustand = Zustand\.NEU,/);
  assert.match(kt, /val conditions: List<Zustand> = emptyList\(\),/);
  assert.match(kt, /^import ch\.brickinventoryapp\.model\.fach\.Zustand$/m);
});

test('gleichnamige Formen werden eine: Felder vereint, Pflicht nur wo alle es verlangen', () => {
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
      '/a': { post: { requestBody: rumpfSchema({ x: { type: 'string' }, y: { type: 'string' } }, ['x', 'y']) } },
      '/b/{nr}': { put: { requestBody: rumpfSchema({ x: { type: 'string' }, y: { type: 'string' } }, ['y']) } },
    },
  );
  assert.match(rumpf, /val y: String,/, 'y verlangen beide Routen');
  assert.match(rumpf, /@EncodeDefault\(EncodeDefault\.Mode\.NEVER\) val x: String\? = null,/, 'x nur eine');
});

/** @param {Record<string, any>} properties @param {string[]} [required] */
function rumpfSchema(properties, required = []) {
  return { content: { 'application/json': { schema: { type: 'object', properties, required } } } };
}

test('ein freiwilliges Rumpffeld geht nur gesetzt hinaus, ausser es soll null sagen', () => {
  const paths = {
    '/r': {
      put: {
        requestBody: rumpfSchema({
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
      FELDTYPEN: { 'Aenderung.menge': 'Int' },
      NULL_SENDEN: new Set(['Aenderung.lagerort']),
      PFLICHT: new Set(['Aenderung.name']),
    },
    paths,
  );
  assert.match(kt, /@EncodeDefault\(EncodeDefault\.Mode\.NEVER\) val menge: Int\? = null,/);
  assert.match(kt, /@SerialName\("lagerort"\) val lagerort: String\? = null,/, 'null heisst beim Server leeren');
  assert.match(kt, /@SerialName\("name"\) val name: String,/, 'Z.PFLICHT: immer gesetzt');
  assert.match(kt, /^@file:OptIn\(ExperimentalSerializationApi::class\)$/m);
});
