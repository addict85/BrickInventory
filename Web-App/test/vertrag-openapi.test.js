/**
 * Der Vertrag (src/vertrag/) deckt jede Route unter /api/v1 ab, die
 * Express wirklich kennt, und docs/openapi.json ist sein aktueller Stand.
 * Die Routen kommen aus den gebauten Routern (ihr stack), nicht aus dem
 * Quelltext: Was dort hängt, beantwortet Anfragen.
 *
 * Gegenproben (31.10.2026 gemessen):
 *   A  in docs/openapi.json einen Feldnamen (used_count) verändert → rot: „die
 *      eingecheckte openapi.json ist erzeugt“
 *   B  den Eintrag 'GET /api/v1/parts/stats' in src/vertrag/teile.ts
 *      umbenannt → rot: „jede Route hat einen Vertrag“ nennt ihn
 *   C  einen Eintrag 'GET /api/v1/gibt-es-nicht' ergänzt → rot: „kein Vertrag
 *      ohne Route“
 *   D  denselben Schlüssel in sets.ts und teile.ts → rot: „kein Schlüssel
 *      doppelt“ (der spätere überschriebe den früheren still)
 *   E  (05.11.2026) `klein: true` an 'GET /api/v1/storage' entfernt → rot:
 *      „jede lange Liste nimmt Seiten“ nennt /api/v1/storage
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const _req = require('./helpers/sources').buildAndRequire();
const { DATEI, alsText } = require('../scripts/vertrag-openapi.js');
const { VERTRAG, BEREICHE } = _req('src/vertrag/index.js');
const { openapi } = _req('src/vertrag/openapi.js');

/** Methode und voller Pfad jeder Route eines Routers, auch in eingehängten Routern. */
function routenVon(router, basis) {
  const aus = [];
  for (const schicht of router.stack) {
    if (schicht.route) for (const m of Object.keys(schicht.route.methods)) aus.push(`${m.toUpperCase()} ${basis}${schicht.route.path}`);
    else if (schicht.handle?.stack) aus.push(...routenVon(schicht.handle, basis));
  }
  return aus;
}
const EXPRESS = [
  ...routenVon(_req('routes/api_v1/index.js'), '/api/v1'),
  ...routenVon(_req('routes/auth.js'), '/api/v1/auth'),
  // Direkt in server.ts: Sie antworten, bevor die Router stehen.
  'GET /api/v1/startup-status', 'GET /api/v1/health', 'GET /api/v1/health/live', 'GET /api/v1/health/ready',
];

test('jede Route hat einen Vertrag', () => {
  assert.ok(EXPRESS.length > 150, `nur ${EXPRESS.length} Routen gefunden — greift die Suche noch?`);
  assert.deepEqual(EXPRESS.filter((k) => !Object.hasOwn(VERTRAG, k)), []);
});

test('kein Vertrag ohne Route', () => {
  assert.deepEqual(Object.keys(VERTRAG).filter((k) => !EXPRESS.includes(k)), []);
});

test('kein Schlüssel doppelt', () => {
  const summe = Object.values(BEREICHE).reduce((n, b) => n + Object.keys(b.routen).length, 0);
  assert.equal(Object.keys(VERTRAG).length, summe);
});

test('die eingecheckte openapi.json ist erzeugt', () => {
  assert.ok(fs.readFileSync(DATEI, 'utf8') === alsText(openapi()),
    'docs/openapi.json weicht vom Vertrag ab — `npm run vertrag:openapi` ausführen und einchecken');
});

test('jede lange Liste nimmt Seiten', () => {
  // Eine Liste ohne Seiten wächst mit dem Bestand; `klein` sagt, dass sie das nicht tut.
  const o = openapi();
  const schema = (s) => (s?.$ref ? o.components.schemas[s.$ref.split('/').pop()] : s);
  const ohne = [], limit = [];
  for (const [p, ops] of Object.entries(o.paths)) {
    const get = ops.get;
    if (!get) continue;
    const antwort = schema(get.responses[200].content['application/json']?.schema);
    const listen = Object.values(antwort?.properties ?? {}).filter(v => schema(v)?.type === 'array');
    const namen = (get.parameters ?? []).map(x => x.name);
    if (listen.length && !get['x-klein'] && !namen.includes('page_size')) ohne.push(p);
    if ((get.parameters ?? []).some(x => x.name === 'limit' && !x.deprecated)) limit.push(p);
  }
  assert.deepEqual(ohne, []);
  assert.deepEqual(limit, [], 'Seitengrösse heisst page_size; limit nur noch veraltet');
});
