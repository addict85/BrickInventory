/**
 * Die Kotlin-Antworttypen der App (core-vertrag, vertrag.erzeugt) sind aus
 * docs/openapi.json erzeugt und eingecheckt: Weicht die Datei vom Vertrag ab,
 * ist dieser Test rot, bis `npm run vertrag:kotlin` sie neu schreibt.
 *
 * Gegenproben (14.11.2026 gemessen):
 *   A  in Vertrag.kt bei CatalogMetaResponse das Feld year_min gestrichen → rot:
 *      „die eingecheckten Kotlin-Typen sind aus openapi.json erzeugt“
 *   B  im Erzeuger optionale Felder ohne `= null` → rot: „ein optionales Feld
 *      ist nullbar mit Vorgabe“, „ein Feld mit null-Zweig …“ und A
 *   C  im Erzeuger anyOf mit null als JsonElement statt als nullbarer Typ → rot:
 *      „ein Feld mit null-Zweig ist nullbar“
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

/** Die Kotlin-Klasse aus einem Mini-Vertrag. @param {any} schema */
const aus = schema => erzeuge({ components: { schemas: { Probe: schema } } });

test('ein Pflichtfeld ist nicht nullbar, ein optionales Feld ist nullbar mit Vorgabe', () => {
  const kt = aus({
    type: 'object',
    properties: { set_number: { type: 'string' }, name: { type: 'string' } },
    required: ['set_number'],
  });
  assert.match(kt, /@SerialName\("set_number"\) val setNumber: String,/);
  assert.match(kt, /@SerialName\("name"\) val name: String\? = null,/);
});

test('ein Feld mit null-Zweig ist nullbar', () => {
  const kt = aus({
    type: 'object',
    properties: { jahr: { anyOf: [{ type: 'integer', minimum: 0, maximum: 3000 }, { type: 'null' }] } },
    required: ['jahr'],
  });
  assert.match(kt, /val jahr: Int\? = null,/);
});

test('Listen, Verweise und verschachtelte Objekte bekommen ihren Typ', () => {
  const kt = aus({
    type: 'object',
    properties: {
      sets: { type: 'array', items: { $ref: '#/components/schemas/set_item' } },
      seite: { type: 'object', properties: { nummer: { type: 'integer' } }, required: ['nummer'] },
    },
    required: ['sets', 'seite'],
  });
  assert.match(kt, /val sets: List<SetItem>,/);
  assert.match(kt, /val seite: ProbeSeite,/);
  assert.match(kt, /data class ProbeSeite\(\n {4}@SerialName\("nummer"\) val nummer: Long,/);
});
