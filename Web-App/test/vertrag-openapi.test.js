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
 *   F  (15.11.2026) SetItem.added_at wieder `.optional()` → rot: „Antwortfelder sind
 *      Pflicht …“ (720 freiwillige, erlaubt 719); SetItem.acq_count wieder `.nullable()`
 *      → rot (701 nullbare, erlaubt 700)
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
    if (schicht.route)
      for (const m of Object.keys(schicht.route.methods)) aus.push(`${m.toUpperCase()} ${basis}${schicht.route.path}`);
    else if (schicht.handle?.stack) aus.push(...routenVon(schicht.handle, basis));
  }
  return aus;
}
const EXPRESS = [
  ...routenVon(require('./helpers/sources').routerAus(_req, 'routes/api_v1/index.js'), '/api/v1'),
  ...routenVon(require('./helpers/sources').routerAus(_req, 'routes/auth.js'), '/api/v1/auth'),
  // Direkt in server.ts: Sie antworten, bevor die Router stehen.
  'GET /api/v1/startup-status',
  'GET /api/v1/health',
  'GET /api/v1/health/live',
  'GET /api/v1/health/ready',
];

test('jede Route hat einen Vertrag', () => {
  assert.ok(EXPRESS.length > 150, `nur ${EXPRESS.length} Routen gefunden — greift die Suche noch?`);
  assert.deepEqual(
    EXPRESS.filter(k => !Object.hasOwn(VERTRAG, k)),
    [],
  );
});

test('kein Vertrag ohne Route', () => {
  assert.deepEqual(
    Object.keys(VERTRAG).filter(k => !EXPRESS.includes(k)),
    [],
  );
});

test('kein Schlüssel doppelt', () => {
  const summe = Object.values(BEREICHE).reduce((n, b) => n + Object.keys(b.routen).length, 0);
  assert.equal(Object.keys(VERTRAG).length, summe);
});

test('die eingecheckte openapi.json ist erzeugt', () => {
  assert.ok(
    fs.readFileSync(DATEI, 'utf8') === alsText(openapi()),
    'docs/openapi.json weicht vom Vertrag ab — `npm run vertrag:openapi` ausführen und einchecken',
  );
});

test('jede lange Liste nimmt Seiten', () => {
  // Eine Liste ohne Seiten wächst mit dem Bestand; `klein` sagt, dass sie das nicht tut.
  const o = openapi();
  const schema = s => (s?.$ref ? o.components.schemas[s.$ref.split('/').pop()] : s);
  const ohne = [],
    limit = [];
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

/** Felder der Antwortschemas (alles, was eine 200 erreicht): wie viele, wie viele freiwillig, wie viele nullbar. */
function antwortFelder(o) {
  const S = o.components.schemas;
  const erreicht = new Set();
  const folge = s => {
    if (!s || typeof s !== 'object') return;
    if (s.$ref) {
      const n = s.$ref.split('/').pop();
      if (erreicht.has(n)) return;
      erreicht.add(n);
      folge(S[n]);
      return;
    }
    for (const v of Object.values(s)) folge(v);
  };
  for (const ops of Object.values(o.paths)) for (const op of Object.values(ops)) folge(op.responses?.['200']);
  const nullbar = s =>
    !!s && (s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null')) || (s.anyOf ?? []).some(nullbar));
  const z = { felder: 0, frei: 0, nullbar: 0 };
  const zaehle = s => {
    if (!s || typeof s !== 'object' || s.$ref) return;
    const pflicht = new Set(s.required ?? []);
    for (const [k, v] of Object.entries(s.properties ?? {})) {
      z.felder++;
      if (!pflicht.has(k)) z.frei++;
      if (nullbar(v)) z.nullbar++;
    }
    for (const [k, v] of Object.entries(s)) if (typeof v === 'object') zaehle(k === 'properties' ? null : v);
    for (const v of Object.values(s.properties ?? {})) zaehle(v);
  };
  for (const n of erreicht) zaehle(S[n]);
  return z;
}

test('Antwortfelder sind Pflicht, wo der Server sie immer liefert: freiwillige und nullbare werden weniger', () => {
  // Ein freiwilliges oder nullbares Feld wird in OpenAPI, den Typen der Oberfläche und in Kotlin nullbar.
  const SCHRANKE = { frei: 719, nullbar: 700 };
  const z = antwortFelder(openapi());
  assert.ok(z.felder > 1500, `nur ${z.felder} Antwortfelder — greift die Suche noch?`);
  assert.ok(z.frei <= SCHRANKE.frei, `${z.frei} freiwillige Antwortfelder, erlaubt sind ${SCHRANKE.frei}`);
  assert.ok(z.nullbar <= SCHRANKE.nullbar, `${z.nullbar} nullbare Antwortfelder, erlaubt sind ${SCHRANKE.nullbar}`);
  if (z.frei < SCHRANKE.frei || z.nullbar < SCHRANKE.nullbar)
    console.log(`  ℹ Antwortfelder frei ${z.frei}, nullbar ${z.nullbar} — Schranke nachziehen`);
});
