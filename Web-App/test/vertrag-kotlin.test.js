/**
 * Die Kotlin-Modelle der App gegen den Vertrag des Servers (src/vertrag/,
 * als JSON-Schema wie in docs/openapi.json): Jede Route, die die App aufruft,
 * hat einen Vertrag, und ihr Antworttyp liest jede Antwort, die der Vertrag
 * erlaubt — Feldnamen (@SerialName), Typ, Nullbarkeit, Pflicht oder optional. …
 * Ausführlich: docs/begruendungen/test/vertrag-kotlin.test.js.md#kopf
 *
 * Gegenproben (31.10.2026 gemessen):
 *   A  im Vertrag SetItem.quantity als z.string() → rot: „die Kotlin-Modelle
 *      passen zum Vertrag“ nennt GET /api/v1/sets $.sets[].quantity: Schema string, Kotlin Int
 *   B  in SetItem (SetModels.kt) ein Feld `val gibtEsNicht: String` ergänzt →
 *      rot: „$.sets[].gibtEsNicht: fehlt im Schema (SetItem)“
 *   C  Profil.emailVerified wieder als Int → rot: „$.user.email_verified:
 *      Schema boolean, Kotlin Int“
 *   D  im Vertrag die Route GET /api/v1/parts/stats umbenannt → rot: „jede
 *      Route der App hat einen Vertrag“ und „… sagt kein JSON“
 *   E  in FEHLEN_ERLAUBT einen erfundenen Schlüssel ergänzt → rot: „jede
 *      erlaubte Lücke gibt es noch“
 *   F  (05.11.2026) im Vertrag `label` aus den Anmeldedaten gestrichen → rot:
 *      „jedes Feld, das die App schickt, kennt der Vertrag“ (LoginRequest.label)
 *   G  (05.11.2026) im Vertrag die Abfrage von GET /api/v1/sets ohne `page_size`
 *      → rot: „jeder Abfrageparameter der App steht im Vertrag“
 *   H  in Fehlercode.kt BARCODE_KEIN_SET("barcode_kein_satz") →
 *      rot: „jeder Fehlercode der App steht im Vertrag“ nennt barcode_kein_satz
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { kotlinModelle, kotlinFehlercodes, apiRouten, schreibRouten, vergleiche, FEHLEN_ERLAUBT } = require('../scripts/kotlin-vertrag.js');
const { quellwurzeln, ANDROID } = require('./helpers/android');

const API = path.join(ANDROID, 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api');
const dok = _req('src/vertrag/openapi.js').openapi();
const modelle = kotlinModelle(quellwurzeln());
const routen = [
  ...apiRouten(API).map((r) => ({ methode: 'GET', pfad: r.pfad, typ: r.typ, anfrage: r.anfrage })),
  ...schreibRouten(API),
];
/** @param {string} p */
const gleichfoermig = (p) => p.replace(/\{\w+\}/g, '{}');
/** Pfad der App → Operation im Vertrag. */
function operation(methode, pfad) {
  const treffer = Object.entries(dok.paths).filter(([p]) => gleichfoermig(p) === gleichfoermig(pfad));
  return treffer.length === 1 ? treffer[0][1][methode.toLowerCase()] : undefined;
}
const aufloesen = (ref) => dok.components.schemas[ref.replace('#/components/schemas/', '')];

test('jede Route der App hat einen Vertrag', () => {
  assert.ok(routen.length > 100, `nur ${routen.length} Routen gelesen — greift der Leser noch?`);
  const ohne = routen.filter((r) => !operation(r.methode, r.pfad)).map((r) => `${r.methode} ${r.pfad}`);
  assert.deepEqual(ohne, []);
});

test('die Kotlin-Modelle passen zum Vertrag', () => {
  const abweichungen = [];
  let geprueft = 0;
  for (const r of routen) {
    const op = operation(r.methode, r.pfad);
    const schema = op?.responses?.[200]?.content?.['application/json']?.schema;
    if (!r.typ || !modelle.has(r.typ)) continue;
    if (!schema) { abweichungen.push(`${r.methode} ${r.pfad}: Kotlin liest ${r.typ}, der Vertrag sagt kein JSON`); continue; }
    geprueft++;
    abweichungen.push(...vergleiche({ art: 'klasse', name: r.typ, nullbar: false }, schema, modelle, aufloesen,
      `${r.methode} ${r.pfad} $`, { route: r.pfad, standardwerte: r.methode === 'GET' }));
  }
  assert.deepEqual(abweichungen, []);
  assert.ok(geprueft >= 140, `nur ${geprueft} Antworttypen verglichen`);
});

test('jede erlaubte Lücke gibt es noch', () => {
  const tot = [...FEHLEN_ERLAUBT.keys()].filter((k) => {
    const [route, feld] = k.split(' ');
    const [klasse, name] = feld.split('.');
    return !routen.some((r) => r.pfad === route) || !modelle.get(klasse)?.felder.some((f) => f.json === name);
  });
  assert.deepEqual(tot, [], 'Eine Ausnahme ohne Route oder Feld verdeckt nichts mehr');
});

// Eingaben sind geschlossen (strictObject): Ein Feld, das die App schickt und
// der Vertrag nicht kennt, wäre im Betrieb eine 400.
test('jedes Feld, das die App schickt, kennt der Vertrag', () => {
  const fehlt = [];
  let geprueft = 0;
  for (const r of routen.filter((x) => x.rumpf && modelle.has(x.rumpf))) {
    const op = operation(r.methode, r.pfad);
    const schema = op?.requestBody?.content?.['application/json']?.schema;
    const felder = new Set(Object.keys(schema?.properties ?? {}));
    geprueft++;
    for (const f of modelle.get(r.rumpf).felder) if (!felder.has(f.json)) fehlt.push(`${r.methode} ${r.pfad} ${r.rumpf}.${f.json}`);
  }
  assert.deepEqual(fehlt, []);
  assert.ok(geprueft >= 35, `nur ${geprueft} Rümpfe verglichen`);
});

test('jeder Abfrageparameter der App steht im Vertrag', () => {
  const fehlt = [];
  let geprueft = 0;
  for (const r of routen) {
    const namen = new Set((operation(r.methode, r.pfad)?.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name));
    for (const a of r.anfrage ?? []) { geprueft++; if (!namen.has(a.name)) fehlt.push(`${r.methode} ${r.pfad} ?${a.name}`); }
  }
  assert.deepEqual(fehlt, []);
  assert.ok(geprueft >= 50, `nur ${geprueft} Abfrageparameter verglichen`);
});

test('der Vergleich schlägt an, wo die App nicht lesen kann', () => {
  const m = new Map([['K', { datei: 'K.kt', felder: [
    { json: 'n', typ: { art: 'int', nullbar: false }, hatDefault: false },
    { json: 'b', typ: { art: 'boolean', nullbar: false }, hatDefault: true },
  ] }]]);
  const k = { art: 'klasse', name: 'K', nullbar: false };
  const passt = { type: 'object', properties: { n: { type: 'integer' }, b: { type: 'boolean' } }, required: ['n', 'b'] };
  assert.deepEqual(vergleiche(k, passt, m, () => ({})), []);
  const zahlAlsSchalter = { ...passt, properties: { ...passt.properties, b: { type: 'integer' } } };
  assert.match(vergleiche(k, zahlAlsSchalter, m, () => ({})).join(), /\$\.b: Schema integer, Kotlin Boolean/);
  const nullErlaubt = { ...passt, properties: { ...passt.properties, n: { anyOf: [{ type: 'integer' }, { type: 'null' }] } } };
  assert.match(vergleiche(k, nullErlaubt, m, () => ({})).join(), /\$\.n: Schema erlaubt null/);
  assert.match(vergleiche(k, { ...passt, required: ['b'] }, m, () => ({})).join(), /\$\.n: im Schema optional/);
  assert.deepEqual(vergleiche(k, { ...passt, required: ['n'] }, m, () => ({}), '$', { standardwerte: false }), [],
    'Schreibantworten: ein Feld mit Standardwert darf fehlen');
});

test('jeder Fehlercode der App steht im Vertrag', () => {
  const datei = path.join(ANDROID, 'core-model', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'model', 'Fehlercode.kt');
  const kennungen = kotlinFehlercodes(datei);
  assert.ok(kennungen.length >= 10, `nur ${kennungen.length} Fehlercodes in Fehlercode.kt gelesen`);
  const imVertrag = new Set(dok.components.schemas.Fehlercode?.enum ?? []);
  assert.deepEqual(kennungen.filter((k) => !imVertrag.has(k)), []);
});
