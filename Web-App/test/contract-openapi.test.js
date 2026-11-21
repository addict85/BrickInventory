/**
 * The contract (src/contract/) covers every route under /api/v1 that
 * Express really knows, and docs/openapi.json is its current state.
 * The routes come from the built routers (their stack), not from the
 * source text: whatever hangs there answers requests.
 *
 * Counter-checks (measured 31.10.2026):
 *   A  in docs/openapi.json a field name (used_count) changed → red: “the
 *      checked-in openapi.json is generated”
 *   B  the entry 'GET /api/v1/parts/stats' in src/contract/parts.ts
 *      renamed → red: “every route has a contract” names it
 *   C  an entry 'GET /api/v1/gibt-es-nicht' added → red: “no contract
 *      without a route”
 *   D  the same key in sets.ts and teile.ts → red: “no key
 *      twice” (the later one would silently overwrite the earlier one)
 *   E  (05.11.2026) `klein: true` removed from 'GET /api/v1/storage' → red:
 *      “every long list takes pages” names /api/v1/storage
 *   F  (15.11.2026) SetItem.added_at back to `.optional()` → red: “response fields are
 *      required …” (720 optional, 719 allowed); SetItem.acq_count back to `.nullable()`
 *      → red (701 nullable, 700 allowed)
 *   G  (15.11.2026, per file) BarcodeResponse.name back to `.nullable().optional()` → red:
 *      “sets: 40 optional, 39 allowed”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const _req = require('./helpers/sources').buildAndRequire();
const { DATEI, alsText } = require('../scripts/contract-openapi.js');
const { CONTRACT, AREAS } = _req('src/contract/index.js');
const { openapi } = _req('src/contract/openapi.js');

/** Method and full path of every route of a router, also in mounted routers. */
function routesOf(router, basis) {
  const aus = [];
  for (const layer of router.stack) {
    if (layer.route)
      for (const m of Object.keys(layer.route.methods)) aus.push(`${m.toUpperCase()} ${basis}${layer.route.path}`);
    else if (layer.handle?.stack) aus.push(...routesOf(layer.handle, basis));
  }
  return aus;
}
const EXPRESS = [
  ...routesOf(require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'), '/api/v1'),
  ...routesOf(require('./helpers/sources').routerFrom(_req, 'routes/auth.js'), '/api/v1/auth'),
  // Directly in server.ts: they answer before the routers are in place.
  'GET /api/v1/startup-status',
  'GET /api/v1/health',
  'GET /api/v1/health/live',
  'GET /api/v1/health/ready',
];

test('every route has a contract', () => {
  assert.ok(EXPRESS.length > 150, `nur ${EXPRESS.length} Routen gefunden — greift die Suche noch?`);
  assert.deepEqual(
    EXPRESS.filter(k => !Object.hasOwn(CONTRACT, k)),
    [],
  );
});

test('no contract without a route', () => {
  assert.deepEqual(
    Object.keys(CONTRACT).filter(k => !EXPRESS.includes(k)),
    [],
  );
});

test('no key twice', () => {
  const summe = Object.values(AREAS).reduce((n, b) => n + Object.keys(b.routen).length, 0);
  assert.equal(Object.keys(CONTRACT).length, summe);
});

test('the checked-in openapi.json is generated', () => {
  assert.ok(
    fs.readFileSync(DATEI, 'utf8') === alsText(openapi()),
    'docs/openapi.json weicht vom Vertrag ab — `npm run vertrag:openapi` ausführen und einchecken',
  );
});

test('every long list takes pages', () => {
  // A list without pages grows with the stock; `klein` says that it does not.
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

/** The contract file of each area key (the keys are tags in openapi.json and stay). */
const CONTRACT_FILE = {
  grund: 'base',
  gemeinsam: 'shared',
  bestand: 'inventory',
  einstellungen: 'settings',
  figuren: 'minifigs',
  finanzen: 'finances',
  geraet: 'device',
  gutscheine: 'vouchers',
  haushalt: 'household',
  katalog: 'catalog',
  konto: 'account',
  merkliste: 'wanted',
  sets: 'sets',
  teile: 'parts',
  verwaltung: 'management',
};

/** The contract file of a schema: where its object is exported, otherwise the scope of the route that names it. */
function fileJeSchema() {
  const datei = new Map();
  for (const f of ['grund', 'gemeinsam', ...Object.keys(AREAS)])
    for (const [n, w] of Object.entries(_req(`src/contract/${CONTRACT_FILE[f]}.js`)))
      if (!datei.has(n) && w?._zod) datei.set(n, f);
  for (const [b, m] of Object.entries(AREAS))
    for (const k of Object.keys(m.routen)) datei.set(k.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, ''), b);
  return datei;
}

/** Fields of the response schemas (everything a 200 reaches), per contract file: how many, optional, nullable. */
function responseFields(o) {
  const S = o.components.schemas;
  const erreicht = new Set();
  const sequence = s => {
    if (!s || typeof s !== 'object') return;
    if (s.$ref) {
      const n = s.$ref.split('/').pop();
      if (erreicht.has(n)) return;
      erreicht.add(n);
      sequence(S[n]);
      return;
    }
    for (const v of Object.values(s)) sequence(v);
  };
  for (const ops of Object.values(o.paths)) for (const op of Object.values(ops)) sequence(op.responses?.['200']);
  const nullbar = s =>
    !!s && (s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null')) || (s.anyOf ?? []).some(nullbar));
  const datei = fileJeSchema();
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

test('response fields are required where the server always delivers them: optional and nullable ones become fewer', () => {
  // An optional or nullable field becomes nullable in OpenAPI, the UI types and in Kotlin.
  // Per contract file so that it is visible where the contract is still soft; total 1728 → 1449 fields,
  // optional 719 → 329 (41.6 % → 22.7 %), nullable 700 → 484.
  const LIMIT = {
    bestand: { frei: 10, nullbar: 12 },
    einstellungen: { frei: 14, nullbar: 11 },
    figuren: { frei: 21, nullbar: 27 },
    finanzen: { frei: 62, nullbar: 125 },
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
  const je = responseFields(openapi());
  const summe = Object.values(je).reduce((a, z) => a + z.felder, 0);
  assert.ok(summe > 1400, `nur ${summe} Antwortfelder — greift die Suche noch?`);
  assert.deepEqual(Object.keys(je).sort(), Object.keys(LIMIT).sort(), 'jede Vertragsdatei hat ihre Schranke');
  const toMuch = [],
    weniger = [];
  for (const [datei, z] of Object.entries(je)) {
    const s = LIMIT[datei];
    for (const art of /** @type {const} */ (['frei', 'nullbar'])) {
      if (z[art] > s[art]) toMuch.push(`${datei}: ${z[art]} ${art}, erlaubt ${s[art]}`);
      if (z[art] < s[art]) weniger.push(`${datei} ${art} ${z[art]}`);
    }
  }
  assert.deepEqual(toMuch, []);
  const frei = Object.values(je).reduce((a, z) => a + z.frei, 0);
  assert.ok(frei / summe < 0.23, `${frei} von ${summe} Antwortfeldern freiwillig`);
  if (weniger.length) console.log(`  ℹ Antwortfelder ${weniger.join(', ')} — Schranke nachziehen`);
});
