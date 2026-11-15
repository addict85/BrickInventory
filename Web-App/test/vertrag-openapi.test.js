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
 *   G  (15.11.2026, je Datei) BarcodeResponse.name wieder `.nullable().optional()` → rot:
 *      „sets: 40 frei, erlaubt 39“
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

/** Die Vertragsdatei eines Schemas: wo sein Objekt exportiert ist, sonst der Bereich der Route, die es benennt. */
function dateiJeSchema() {
  const datei = new Map();
  for (const f of ['grund', 'gemeinsam', ...Object.keys(BEREICHE)])
    for (const [n, w] of Object.entries(_req(`src/vertrag/${f}.js`))) if (!datei.has(n) && w?._zod) datei.set(n, f);
  for (const [b, m] of Object.entries(BEREICHE))
    for (const k of Object.keys(m.routen)) datei.set(k.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, ''), b);
  return datei;
}

/** Felder der Antwortschemas (alles, was eine 200 erreicht), je Vertragsdatei: wie viele, freiwillig, nullbar. */
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
  const datei = dateiJeSchema();
  const je = {};
  for (const n of erreicht) {
    const d = datei.get(n) ?? '?';
    je[d] ??= { felder: 0, frei: 0, nullbar: 0 };
    const z = je[d];
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
    zaehle(S[n]);
  }
  return je;
}

test('Antwortfelder sind Pflicht, wo der Server sie immer liefert: freiwillige und nullbare werden weniger', () => {
  // Ein freiwilliges oder nullbares Feld wird in OpenAPI, den Typen der Oberfläche und in Kotlin nullbar.
  // Je Vertragsdatei, damit sichtbar ist, wo der Vertrag noch weich ist; gesamt 1728 → 1449 Felder,
  // freiwillig 719 → 321 (41,6 % → 22,2 %), nullbar 700 → 484.
  const SCHRANKE = {
    bestand: { frei: 10, nullbar: 12 },
    einstellungen: { frei: 14, nullbar: 11 },
    figuren: { frei: 21, nullbar: 27 },
    finanzen: { frei: 54, nullbar: 125 },
    gemeinsam: { frei: 35, nullbar: 50 },
    geraet: { frei: 0, nullbar: 0 },
    gutscheine: { frei: 10, nullbar: 17 },
    haushalt: { frei: 1, nullbar: 4 },
    katalog: { frei: 2, nullbar: 21 },
    konto: { frei: 52, nullbar: 55 },
    merkliste: { frei: 32, nullbar: 33 },
    sets: { frei: 39, nullbar: 58 },
    teile: { frei: 9, nullbar: 20 },
    verwaltung: { frei: 42, nullbar: 51 },
  };
  const je = antwortFelder(openapi());
  const summe = Object.values(je).reduce((a, z) => a + z.felder, 0);
  assert.ok(summe > 1400, `nur ${summe} Antwortfelder — greift die Suche noch?`);
  assert.deepEqual(Object.keys(je).sort(), Object.keys(SCHRANKE).sort(), 'jede Vertragsdatei hat ihre Schranke');
  const zuViel = [],
    weniger = [];
  for (const [datei, z] of Object.entries(je)) {
    const s = SCHRANKE[datei];
    for (const art of /** @type {const} */ (['frei', 'nullbar'])) {
      if (z[art] > s[art]) zuViel.push(`${datei}: ${z[art]} ${art}, erlaubt ${s[art]}`);
      if (z[art] < s[art]) weniger.push(`${datei} ${art} ${z[art]}`);
    }
  }
  assert.deepEqual(zuViel, []);
  const frei = Object.values(je).reduce((a, z) => a + z.frei, 0);
  assert.ok(frei / summe < 0.23, `${frei} von ${summe} Antwortfeldern freiwillig`);
  if (weniger.length) console.log(`  ℹ Antwortfelder ${weniger.join(', ')} — Schranke nachziehen`);
});
