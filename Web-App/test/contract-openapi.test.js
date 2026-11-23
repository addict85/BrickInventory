/**
 * The contract (src/contract/) covers every route under /api/v1 that
 * Express really knows, and docs/openapi.json is its current state.
 * The routes come from the built routers (their stack), not from the
 * source text: whatever hangs there answers requests.
 *
 * Counter-checks (measured 31.10.2026):
 *   A  in docs/openapi.json a field name (used_count) changed → red: “the
 *      checked-in openapi.json is generated”
 *   B  the entry 'GET /api/v2/parts/stats' in src/contract/parts.ts
 *      renamed → red: “every route has a contract” names it
 *   C  an entry 'GET /api/v2/gibt-es-nicht' added → red: “no contract
 *      without a route”
 *   D  the same key in sets.ts and teile.ts → red: “no key
 *      twice” (the later one would silently overwrite the earlier one)
 *   E  (05.11.2026) `klein: true` removed from 'GET /api/v2/storage' → red:
 *      “every long list takes pages” names /api/v2/storage
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
const { OUT_FILE, OUT_FILE_V2, asText } = require('../scripts/contract-openapi.js');
const { CONTRACT, AREAS } = _req('src/contract/index.js');
const { openapi } = _req('src/contract/openapi.js');

/** Method and full path of every route of a router, also in mounted routers. */
function routesOf(router, basis) {
  const out = [];
  for (const layer of router.stack) {
    if (layer.route)
      for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${basis}${layer.route.path}`);
    else if (layer.handle?.stack) out.push(...routesOf(layer.handle, basis));
  }
  return out;
}
const EXPRESS = [
  ...routesOf(require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'), '/api/v2'),
  ...routesOf(require('./helpers/sources').routerFrom(_req, 'routes/auth.js'), '/api/v2/auth'),
  // Directly in server.ts: they answer before the routers are in place.
  'GET /api/v2/startup-status',
  'GET /api/v2/health',
  'GET /api/v2/health/live',
  'GET /api/v2/health/ready',
];

test('every route has a contract', () => {
  assert.ok(EXPRESS.length > 150, `only ${EXPRESS.length} routes found — does the search still match?`);
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
  const sum = Object.values(AREAS).reduce((n, b) => n + Object.keys(b.routes).length, 0);
  assert.equal(Object.keys(CONTRACT).length, sum);
});

test('the checked-in openapi.json is generated', () => {
  assert.ok(
    fs.readFileSync(OUT_FILE, 'utf8') === asText(openapi()),
    'docs/openapi.json differs from the contract — run `npm run contract:openapi` and check it in',
  );
});

test('the checked-in openapi-v2.json is generated from the same contract', () => {
  // Counter-check (22.11.2026): in docs/openapi-v2.json the first `"heartbeat"` renamed to `lebenszeichen` → red.
  assert.ok(
    fs.readFileSync(OUT_FILE_V2, 'utf8') === asText(openapi(2)),
    'docs/openapi-v2.json differs from the contract — run `npm run contract:openapi` and check it in',
  );
});

test('every long list takes pages', () => {
  // A list without pages grows with the stock; `klein` says that it does not.
  const o = openapi();
  const schema = s => (s?.$ref ? o.components.schemas[s.$ref.split('/').pop()] : s);
  const without = [],
    limit = [];
  for (const [p, ops] of Object.entries(o.paths)) {
    const get = ops.get;
    if (!get) continue;
    const response = schema(get.responses[200].content['application/json']?.schema);
    const listen = Object.values(response?.properties ?? {}).filter(v => schema(v)?.type === 'array');
    const names = (get.parameters ?? []).map(x => x.name);
    if (listen.length && !get['x-klein'] && !names.includes('page_size')) without.push(p);
    if ((get.parameters ?? []).some(x => x.name === 'limit' && !x.deprecated)) limit.push(p);
  }
  assert.deepEqual(without, []);
  assert.deepEqual(limit, [], 'The page size is called page_size; limit is only deprecated');
});

/** The contract file of each area key (the keys are tags in openapi.json and stay). */
const CONTRACT_FILE = {
  base: 'base',
  shared: 'shared',
  inventory: 'inventory',
  settings: 'settings',
  minifigs: 'minifigs',
  finances: 'finances',
  device: 'device',
  vouchers: 'vouchers',
  household: 'household',
  catalog: 'catalog',
  account: 'account',
  wanted: 'wanted',
  sets: 'sets',
  parts: 'parts',
  management: 'management',
};

/** The contract file of a schema: where its object is exported, otherwise the scope of the route that names it. */
function filePerSchema() {
  // The documents carry the v1 names of the schemas (src/contract/v1Names.ts).
  const { v1SchemaName } = _req('src/contract/v1Names.js');
  const { v1Key } = _req('src/contract/v1Routes.js');
  const file = new Map();
  for (const f of ['base', 'shared', ...Object.keys(AREAS)])
    for (const [n, w] of Object.entries(_req(`src/contract/${CONTRACT_FILE[f]}.js`)))
      if (!file.has(v1SchemaName(n)) && w?._zod) file.set(v1SchemaName(n), f);
  for (const [b, m] of Object.entries(AREAS))
    for (const k of Object.keys(m.routes))
      file.set(
        v1Key(k)
          .replace(/[^A-Za-z0-9]+/g, '_')
          .replace(/_+$/, ''),
        b,
      );
  return file;
}

/** Fields of the response schemas (everything a 200 reaches), per contract file: how many, optional, nullable. */
function responseFields(o) {
  const S = o.components.schemas;
  const reached = new Set();
  const sequence = s => {
    if (!s || typeof s !== 'object') return;
    if (s.$ref) {
      const n = s.$ref.split('/').pop();
      if (reached.has(n)) return;
      reached.add(n);
      sequence(S[n]);
      return;
    }
    for (const v of Object.values(s)) sequence(v);
  };
  for (const ops of Object.values(o.paths)) for (const op of Object.values(ops)) sequence(op.responses?.['200']);
  const nullable = s =>
    !!s && (s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null')) || (s.anyOf ?? []).some(nullable));
  const file = filePerSchema();
  const per = {};
  for (const n of reached) {
    const d = file.get(n) ?? '?';
    per[d] ??= { fields: 0, free: 0, nullable: 0 };
    const z = per[d];
    const count = s => {
      if (!s || typeof s !== 'object' || s.$ref) return;
      const required = new Set(s.required ?? []);
      for (const [k, v] of Object.entries(s.properties ?? {})) {
        z.fields++;
        if (!required.has(k)) z.free++;
        if (nullable(v)) z.nullable++;
      }
      for (const [k, v] of Object.entries(s)) if (typeof v === 'object') count(k === 'properties' ? null : v);
      for (const v of Object.values(s.properties ?? {})) count(v);
    };
    count(S[n]);
  }
  return per;
}

test('response fields are required where the server always delivers them: optional and nullable ones become fewer', () => {
  // An optional or nullable field becomes nullable in OpenAPI, the UI types and in Kotlin.
  // Per contract file so that it is visible where the contract is still soft; total 1728 → 1449 fields,
  // optional 719 → 329 (41.6 % → 22.7 %), nullable 700 → 484.
  const LIMIT = {
    inventory: { free: 10, nullable: 12 },
    settings: { free: 14, nullable: 11 },
    minifigs: { free: 21, nullable: 27 },
    finances: { free: 62, nullable: 125 },
    shared: { free: 35, nullable: 50 },
    device: { free: 0, nullable: 0 },
    vouchers: { free: 10, nullable: 17 },
    household: { free: 1, nullable: 4 },
    catalog: { free: 2, nullable: 21 },
    account: { free: 52, nullable: 55 },
    wanted: { free: 32, nullable: 33 },
    sets: { free: 39, nullable: 58 },
    parts: { free: 9, nullable: 20 },
    management: { free: 42, nullable: 51 },
  };
  const per = responseFields(openapi());
  const sum = Object.values(per).reduce((a, z) => a + z.fields, 0);
  assert.ok(sum > 1400, `only ${sum} response fields — does the search still match?`);
  assert.deepEqual(Object.keys(per).sort(), Object.keys(LIMIT).sort(), 'every contract file has its limit');
  const toMuch = [],
    lessThan = [];
  for (const [file, z] of Object.entries(per)) {
    const s = LIMIT[file];
    for (const kind of /** @type {const} */ (['free', 'nullable'])) {
      if (z[kind] > s[kind]) toMuch.push(`${file}: ${z[kind]} ${kind}, erlaubt ${s[kind]}`);
      if (z[kind] < s[kind]) lessThan.push(`${file} ${kind} ${z[kind]}`);
    }
  }
  assert.deepEqual(toMuch, []);
  const free = Object.values(per).reduce((a, z) => a + z.free, 0);
  assert.ok(free / sum < 0.23, `${free} von ${sum} Antwortfeldern freiwillig`);
  if (lessThan.length) console.log(`  ℹ response fields ${lessThan.join(', ')} — tighten the limit`);
});
