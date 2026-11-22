/**
 * Tables without user_id are shared by all accounts. Which ones they are stands below
 * in SHARED, per table with kind and whether inputs of an account may go in.
 * The tables come from the real schema, the writing places from the
 * source text (a new place on a catalog table must be registered here …
 *
 * Counter-checks (measured on 04.11.2026, one change each, reverted afterwards):
 *   A  routes/api_v1/wanted.ts: rememberNumber always writes rememberBlNumber →
 *      red: “input of an account lands in no shared table”
 *      (bl_mapping carries the marker)
 *   B  rememberMinifig() in src/catalog/catalogMaintenance.ts without the branch for `von` →
 *      red: the same check (minifigs_catalog)
 *   C  an `INSERT INTO part_catalog` in src/parts/repository/manualParts.ts
 *      → red: “every writing site on a catalog table is registered”
 *   D  a table `probe_gemeinsam (x int)` via migration → red: “every
 *      table without user_id is in the list”
 *
 * Every table has an owner scope (BESITZER); only it writes into it,
 * others call its service. Counter-checks (measured 10.11.2026):
 *   E  `DELETE FROM price_cache` back into src/management/repository/management.ts
 *      → red: “every table has an owner, only it writes into it” (and
 *      “every writing site on a catalog table …”)
 *   F  merkeKatalogCache back into src/sets/repository/setDetail.ts → red: the same
 *      check (and “every writing site on a catalog table …”)
 *   G  the line 'db/schemaStart.ts → global_settings' deleted from FREMDSCHREIBER
 *      → red: the same check
 *
 * The owners stand in docs/architecture.md („Tabellen und Besitzer“), exactly one per table.
 * Foreign scopes read via read building blocks in db/ or the owner's service; the direct
 * read places are counted by a ratchet, upwards zero applies. Counter-checks (H 15.11., I/J 14.11.2026 measured):
 *   H  `SELECT 1 FROM price_cache` in src/sets/repository/sets.ts → red: “foreign scopes never read
 *      upwards …” (27 downwards of 26)
 *   I  `DELETE FROM user_settings` in src/account/repository/accounts.ts → red: “every table has
 *      an owner, only it writes into it”
 *   J  the line of src/drossel deleted in docs/architecture.md → red: the same check
 *      (rate_limit_attempts without owner)
 *   K  setWert.ts again reads `FROM set_acquisitions` instead of setErfassungen() → red: the same
 *      check, upwards ['src/finances → set_acquisitions'] (15.11.2026)
 *   L  'src/sets → parts_version_user' deleted from TRIGGER_FREMDZIELE → red: “triggers only write
 *      into tables of their owner …” (15.11.2026)
 *
 * A read building block in db/ counts for the scope that imports it; what it reads is shown by its result.
 * If the scope lies below the owner, it gets the building block via its read contract (src/services.ts
 * passes it). Counter-checks (measured 15.11.2026, each on its own):
 *   M  src/images/repository/imageScope.ts imports countedSets again from db/inventoryView →
 *      red: “… via db/” ['src/images → price_alerts', 'src/images → sets', 'src/images → wanted']
 *   N  src/catalog/repository/catalogSearch.ts imports mengeJoin again from db/stockQuantity → red:
 *      the same check, ['src/catalog → set_acquisitions']
 *   O  setBestand in db/inventoryView.ts reads `FROM parts` → red at the self-proof „setBestand liest
 *      sets“; if it assembles the name at runtime, it stays green: the result is what is counted.
 *
 * If a file chooses the table name at runtime, what counts is what it reads and writes when called via a recording
 * access (DYNAMISCH, measureFile). Counter-checks (measured 15.11.2026, each on its own):
 *   P  src/inventory/repository/storageLocation.ts: TABELLEN.set = 'instructions' → red: “measured as
 *      registered”, “only it writes into it” ['…/lagerort.ts → instructions'] and “never read
 *      upwards” ['src/inventory → instructions']; the regex on literal names saw neither
 *   Q  cacheNumbers() in src/catalog/repository/catalogCache.ts again counts zaehle('price_cache') →
 *      red: “measured as registered” and “never read upwards” ['src/catalog → price_cache']
 *   R  src/wanted/repository/wanted.ts again reads `FROM sets s` instead of setBestand() → red:
 *      „25 direkte Lesestellen (abwärts), erlaubt sind 24“
 *
 * Every account makes the inputs in its own name (asAccount) as the runtime role, as in
 * production; test data and the search for it run via the owner role.
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, ohneKommentare, testData, asAccount, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { importWorker } = require('./helpers/jobs');
const db = testData();
const { testServer } = require('./helpers/server');

// Without network: Rebrickable knows nothing (testSources), then only the input itself remains.
testSources(null, {
  lookupPart: async () => null,
  getMinifigInfo: async () => null,
  setDetails: async () => null,
});

const KATALOG = 'katalog'; // verified sources (Rebrickable, BrickLink, Brickset, ECB)
const BETRIEB = 'betrieb'; // state of the server, no details about parts
const KONTO = 'account_id'; // belongs to an account via another key

/** type, eingabe (false or why inputs may go in), schreiber (catalog only). */
const SHARED = {
  bl_mapping: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/blMapping.ts'] },
  catalog_cache: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/catalog/repository/catalogCache.ts', 'src/catalog/repository/rebrickableCache.ts'],
  },
  set_catalog: {
    type: KATALOG,
    eingabe: false,
    schreiber: [
      'src/catalog/repository/imageState.ts',
      'src/catalog/repository/csvSwap.ts',
      'src/catalog/repository/setMaster.ts',
      'src/catalog/repository/partsEnrichment.ts',
    ],
  },
  part_catalog: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/catalogMaster.ts'] },
  part_color_catalog: {
    type: KATALOG,
    eingabe: false,
    schreiber: [
      'src/catalog/repository/csvCatalog.ts',
      'src/catalog/repository/catalogMaster.ts',
      'src/catalog/repository/partsEnrichment.ts',
    ],
  },
  minifigs_catalog: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/catalog/repository/catalogMaster.ts', 'src/catalog/repository/partsEnrichment.ts'],
  },
  set_parts: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/catalogMaster.ts'] },
  set_minifigs: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/catalogMaster.ts'] },
  subsets_cache: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/catalog/repository/catalogCache.ts', 'src/catalog/repository/rebrickableCache.ts'],
  },
  minifig_parts_cache: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/rebrickableCache.ts'] },
  shared_instructions: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/instructions.ts'] },
  rb_colors: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/catalog/repository/blMapping.ts', 'src/catalog/repository/csvSwap.ts'],
  },
  rb_inventories: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/csvSwap.ts'] },
  rb_inventory_minifigs: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/csvSwap.ts'] },
  rb_inventory_parts: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/csvSwap.ts'] },
  rb_part_categories: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/csvSwap.ts'] },
  rb_parts: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/csvSwap.ts'] },
  rb_sets: {
    type: KATALOG,
    eingabe: false,
    schreiber: [
      'src/catalog/repository/imageState.ts',
      'src/catalog/repository/csvSwap.ts',
      'src/catalog/repository/setMaster.ts',
    ],
  },
  rb_themes: { type: KATALOG, eingabe: false, schreiber: ['src/catalog/repository/csvSwap.ts'] },
  price_cache: { type: KATALOG, eingabe: false, schreiber: ['src/finances/repository/priceCache.ts'] },
  price_history: {
    type: KATALOG,
    eingabe: false,
    schreiber: [
      'src/finances/repository/priceCache.ts',
      'src/finances/repository/priceRun.ts',
      'src/finances/repository/priceHistory.ts',
    ],
  },
  part_price_cache: { type: KATALOG, eingabe: false, schreiber: ['src/finances/repository/priceCache.ts'] },
  part_price_history: { type: KATALOG, eingabe: false, schreiber: ['src/finances/repository/priceCache.ts'] },
  minifig_price_cache: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/finances/repository/marketPrices.ts', 'src/finances/repository/priceCache.ts'],
  },
  minifig_price_history: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/finances/repository/marketPrices.ts', 'src/finances/repository/priceCache.ts'],
  },
  exchange_rates: { type: KATALOG, eingabe: false, schreiber: ['src/finances/repository/exchangeRates.ts'] },
  image_misses: { type: BETRIEB, eingabe: false },
  image_wanted: { type: BETRIEB, eingabe: false },
  parts_catalog_pending: {
    type: BETRIEB,
    eingabe: 'Nummern, deren Teile-Zusammenfassung nachzuziehen ist; sie ändern keine Angabe',
  },
  api_cadence: { type: BETRIEB, eingabe: false },
  job_pauses: { type: BETRIEB, eingabe: false },
  job_exclusive_locks: { type: BETRIEB, eingabe: false },
  job_types: { type: BETRIEB, eingabe: false },
  run_state: { type: BETRIEB, eingabe: false },
  schema_migrations: { type: BETRIEB, eingabe: false },
  global_settings: { type: BETRIEB, eingabe: 'nur Verwalter (requireAdmin)' },
  app_logs: { type: BETRIEB, eingabe: 'Protokollzeilen nennen Eingaben, steuern aber nichts' },
  rate_limit_attempts: { type: BETRIEB, eingabe: 'Schlüssel aus Benutzername und Adresse der Anmeldebremse' },
  users: { type: KONTO, eingabe: 'Zeile des Kontos (id)' },
  user_sessions: { type: KONTO, eingabe: 'Sitzung eines Kontos (sess.userId)' },
  account_links: { type: KONTO, eingabe: 'Haushalt (main_user_id, sub_user_id)' },
  account_link_invites: { type: KONTO, eingabe: 'Einladung des Hauptkontos (main_user_id)' },
  household_former_links: { type: KONTO, eingabe: 'frühere Haushalte (main_user_id, sub_user_id)' },
  api_calls: { type: KONTO, eingabe: 'Zähler je Konto (account_id)' },
  voucher_balance_throttle: { type: KONTO, eingabe: 'je Gutschein (id = vouchers.id)' },
  admin_log: { type: KONTO, eingabe: 'Handlungen der Verwalter (admin_id)' },
  admin_takeovers: { type: KONTO, eingabe: 'angekündigte Änderung an einem Verwalterkonto (target_id)' },
};

/** Files that choose a table name at runtime (not via the read contract `l.`): what they
 * read and write, measured (measureFile). If it stands here, the measurement is complete; owners
 * and levels apply to what is measured as to literal names. */
const DYNAMISCH = {
  'src/inventory/repository/acquisitions.ts': {
    liest: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    schreibt: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/inventory/repository/shared.ts': {
    liest: [
      'minifigs',
      'parts',
      'rb_sets',
      'rb_themes',
      'set_acquisitions',
      'set_catalog',
      'sets',
      'storage_locations',
      'user_settings',
    ],
    schreibt: ['minifigs', 'parts', 'set_acquisitions', 'sets'],
  },
  'src/inventory/repository/purchases.ts': {
    liest: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    schreibt: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/inventory/repository/purchaseAcquisitions.ts': {
    liest: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    schreibt: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/inventory/repository/storageLocation.ts': {
    liest: ['minifigs', 'parts', 'sets', 'storage_locations', 'users'],
    schreibt: ['minifigs', 'parts', 'sets', 'storage_locations'],
  },
  'src/inventory/repository/manualQuantities.ts': {
    liest: ['minifig_acquisitions', 'part_acquisitions'],
    schreibt: ['minifig_acquisitions', 'part_acquisitions'],
  },
  'src/inventory/repository/trash.ts': {
    liest: [
      'minifig_acquisitions',
      'minifig_custom',
      'minifigs',
      'minifigs_catalog',
      'part_acquisitions',
      'part_catalog',
      'part_color_catalog',
      'part_color_custom',
      'part_custom',
      'parts',
      'rb_sets',
      'set_acquisitions',
      'sets',
      'trash',
    ],
    schreibt: ['minifig_acquisitions', 'minifigs', 'part_acquisitions', 'parts', 'set_acquisitions', 'sets', 'trash'],
  },
  'src/inventory/repository/reassign.ts': {
    liest: ['minifig_acquisitions', 'minifigs', 'part_acquisitions', 'parts'],
    schreibt: ['minifig_acquisitions', 'minifigs', 'part_acquisitions', 'parts'],
  },
  'src/finances/repository/priceHistory.ts': {
    liest: [
      'minifig_price_cache',
      'minifig_price_history',
      'part_price_cache',
      'part_price_history',
      'price_cache',
      'price_history',
    ],
    schreibt: ['price_history'],
  },
  'src/vouchers/repository/vouchers.ts': { liest: ['vouchers'], schreibt: ['vouchers'] },
  'src/catalog/repository/csvSwap.ts': {
    liest: [
      'rb_colors',
      'rb_inventories',
      'rb_inventory_minifigs',
      'rb_inventory_parts',
      'rb_part_categories',
      'rb_parts',
      'rb_sets',
      'rb_themes',
    ],
    schreibt: [
      'rb_colors',
      'rb_inventories',
      'rb_inventory_minifigs',
      'rb_inventory_parts',
      'rb_part_categories',
      'rb_parts',
      'rb_sets',
      'rb_themes',
      'set_catalog',
    ],
  },
  'src/catalog/repository/catalogCache.ts': {
    liest: ['catalog_cache', 'rb_sets', 'set_catalog', 'subsets_cache'],
    schreibt: ['catalog_cache', 'subsets_cache'],
  },
  'src/catalog/repository/partsEnrichment.ts': {
    liest: [
      'bl_mapping',
      'minifigs_catalog',
      'part_color_catalog',
      'rb_inventories',
      'rb_inventory_parts',
      'set_catalog',
    ],
    schreibt: ['minifigs_catalog', 'part_color_catalog', 'set_catalog'],
  },
  'src/sets/repository/sets.ts': {
    liest: [
      'instructions',
      'rb_sets',
      'rb_themes',
      'set_acquisitions',
      'set_catalog',
      'sets',
      'shared_instructions',
      'storage_locations',
      'user_settings',
    ],
    schreibt: [],
  },
};

const WRITE =
  /\b(?:INSERT INTO|DELETE FROM|TRUNCATE(?: TABLE)?)\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)|(?<!DO )\bUPDATE\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)[^;`'"]*?\bSET\b/g;
const LIES = /\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\b/g;
const NAME_ZUR_LAUFZEIT =
  /\b(?:FROM|JOIN|USING|INSERT INTO|DELETE FROM|UPDATE|TRUNCATE(?: TABLE)?)\s+(?:ONLY\s+)?\$\{\s*([\w$]+)(\s*[.[(])?/g;

/** Files under src/ whose SQL takes a table name from an own variable. Exempt:
 * the read contract (`l.…`) and read building blocks from db/, whose result the check measures via db/. */
function filesWithNamesToRuntime() {
  const aus = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) lauf(p);
      else if (n.endsWith('.ts')) {
        const s = ohneKommentare(fs.readFileSync(p, 'utf8'));
        const fromDb = new Set(
          [...s.matchAll(/^import\s+\{([^}]*)\}\s+from\s+'(?:\.\.?\/)+db\/\w+'/gm)].flatMap(m =>
            m[1].split(',').map(x =>
              x
                .trim()
                .split(/\s+as\s+/)
                .pop(),
            ),
          ),
        );
        const eigen = [...s.matchAll(NAME_ZUR_LAUFZEIT)].some(
          m => !(m[1] === 'l' && /[.[]/.test(m[2] ?? '')) && !(fromDb.has(m[1]) && (m[2] ?? '').trim() === '('),
        );
        if (eigen) aus.push(path.relative(ROOT, p).split(path.sep).join('/'));
      }
    }
  })(path.join(ROOT, 'src'));
  return aus.sort();
}

/** A value that fits every probe: number, text, list, object, read contract. */
function chamaeleon() {
  const c = new Proxy(() => c, {
    get(_, p) {
      if (p === Symbol.toPrimitive) return h => (h === 'number' ? 1 : 'x');
      if (p === Symbol.iterator)
        return function* () {
          yield 'x';
          yield 1;
        };
      if (p === 'then' || p === 'toJSON') return undefined;
      if (p === 'length') return 2;
      return c;
    },
    has: () => true,
    apply: () => c,
  });
  return c;
}

const ARTEN = ['set', 'part', 'fig', 'teil', 'figur'];

/** Calls every export of the file per kind via an access that only records the queries. If the
 * caller chooses the name, then from an exported list of the file: its values are further probes.
 * @returns read and written tables, as far as the schema knows them */
async function measureFile(datei, bekannt) {
  const liest = new Set(),
    schreibt = new Set();
  const c = chamaeleon();
  const remember = sql => {
    for (const m of String(sql).matchAll(LIES)) if (bekannt.has(m[1])) liest.add(m[1]);
    for (const m of String(sql).matchAll(WRITE)) if (bekannt.has(m[1] ?? m[2])) schreibt.add(m[1] ?? m[2]);
  };
  const antwort = value => async sql => {
    remember(sql);
    return value;
  };
  const zugang = {
    get: antwort(c),
    all: antwort([c]),
    run: antwort({ changes: 1 }),
    query: antwort({ rows: [c], rowCount: 1 }),
  };
  const modul = _req(datei.replace(/\.ts$/, '.js'));
  const listen = Object.values(modul).filter(Array.isArray).flat();
  const arten = [...ARTEN, ...listen.filter(x => typeof x === 'string')];
  for (const f of Object.values(modul))
    if (typeof f === 'function')
      for (const type of arten)
        for (const probe of [
          [zugang, type, c, c, c, c, c, c],
          [zugang, c, type, c, c, c, c, c],
        ])
          try {
            const r = f(...probe);
            if (r && typeof r.then === 'function') await r.catch(() => {});
          } catch {
            // A probe that does not fit asks nothing.
          }
  return { liest: [...liest].sort(), schreibt: [...schreibt].sort() };
}

/** Per scope the tables into which only it writes: the table in docs/architecture.md. */
function besitzerAusDoku() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const abschnitt = doc.slice(doc.indexOf('## Tabellen und Besitzer'), doc.indexOf('## API-Vertrag'));
  return Object.fromEntries(
    [...abschnitt.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map(m => [
      m[1],
      [...m[2].matchAll(/`([^`]+)`/g)].map(x => x[1]),
    ]),
  );
}
const BESITZER = besitzerAusDoku();

/** Exceptions to „only the owner writes“; a ratchet: only delete, never add. */
const FREMDSCHREIBER = [
  // The schema start writes the time zone before there are services.
  'db/schemaStart.ts → global_settings',
];

/** Triggers that write into the table of another scope: „owner of the trigger table →
 * target“ and why that does not go via the target's service. A ratchet like FREMDSCHREIBER. */
const TRIGGER_FREMDZIELE = {
  'src/inventory → parts_version_user':
    'Der Teilezähler muss jede Änderung an Sets, Käufen, Teilen und Lagerorten sehen, auch ohne src/parts',
  'src/catalog → parts_catalog_pending':
    'Katalogänderungen merken nur die Nummer vor; src/parts zieht die Zusammenfassung nach und leert die Liste',
};

/** Do foreign scopes read a table directly (FROM, JOIN, USING) instead of via a read building block
 * in db/ or the owner's service? Pairs „scope → table“; db/ itself is the read building block.
 * Upwards (owner on a higher level) is forbidden; catalog tables are shared master data
 * and are counted separately; the rest reads downwards and may only become fewer. */
const KATALOG_LESER_HOECHSTENS = 49;
const ABWAERTS_LESER_HOECHSTENS = 24;

/** Per scope its level from docs/architecture.md („Rangfolge der Bereiche“). */
function stufenAusDoku() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const abschnitt = doc.slice(doc.indexOf('## Rangfolge der Bereiche'), doc.indexOf('## Schema'));
  return new Map(
    [...abschnitt.matchAll(/^\| (\d+) \| (.+) \|$/gm)].flatMap(m =>
      [...m[2].matchAll(/`([^`]+)`/g)].map(x => [x[1], Number(m[1])]),
    ),
  );
}

/** „aufwärts“, „katalog“ or „abwärts“ for the reader `b` of a table of the owner `owner`. */
function readDirection(stufen, b, owner) {
  if (owner === 'src/catalog') return 'katalog';
  return stufen.get(owner) > stufen.get(b) ? 'aufwärts' : 'abwärts';
}

function foreignReader(besitzer) {
  const pairs = new Set();
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) lauf(p);
      else if (n.endsWith('.ts')) {
        const datei = path.relative(ROOT, p).split(path.sep).join('/');
        const b = areaOf(datei);
        const s = ohneKommentare(fs.readFileSync(p, 'utf8'));
        for (const m of s.matchAll(/\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/g))
          if (besitzer.has(m[1]) && besitzer.get(m[1]) !== b) pairs.add(`${b} → ${m[1]}`);
      }
    }
  })(path.join(ROOT, 'src'));
  return [...pairs].sort();
}

const areaOf = datei => (datei.startsWith('src/') ? datei.split('/').slice(0, 2).join('/') : datei.split('/')[0]);

const LESE = /\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/g;

/** Per read building block in db/ and export the tables its result reads: every function runs with
 * probes per kind and an access that only records the queries. That way what is read via a
 * constant (ZAEHLT) or an asynchronous query counts too. */
async function lesebausteine(_req) {
  const je = {};
  const ordner = path.join(ROOT, 'db');
  for (const n of fs.readdirSync(ordner)) {
    if (!n.endsWith('.ts') || ['database.ts', 'migrate.ts', 'schemaStart.ts'].includes(n)) continue;
    if (!/\b(?:FROM|JOIN)\b/.test(fs.readFileSync(path.join(ordner, n), 'utf8'))) continue;
    const modul = n.replace(/\.ts$/, '');
    je[modul] = {};
    for (const [name, value] of Object.entries(_req(`db/${modul}.js`))) {
      const tabellen = new Set();
      const remember = sql => {
        for (const m of String(sql).matchAll(LESE)) tabellen.add(m[1]);
      };
      const zugang = {
        get: async sql => {
          remember(sql);
          return null;
        },
        all: async sql => {
          remember(sql);
          return [];
        },
        run: async sql => remember(sql),
        toString: () => '$9',
      };
      if (typeof value === 'string') remember(value);
      else if (typeof value === 'function')
        for (const type of ['part', 'fig', 'set']) {
          const proben = [
            [],
            ['= ANY($1)'],
            [type, '$1', ['3001', 4], zugang],
            ['s', type, 'tm', '= ANY($1)'],
            ['$1', '$2', zugang],
            [1, '3001-1', zugang],
          ];
          for (const probe of proben) {
            try {
              const r = value(...probe);
              if (r && typeof r.then === 'function') await r.catch(() => {});
              else remember(r);
            } catch {
              // A probe that does not fit reads nothing.
            }
          }
        }
      if (tabellen.size) je[modul][name] = [...tabellen].sort();
    }
  }
  return je;
}

/** Pairs „scope → table“ that a scope reads via imported read building blocks (also `* as`). */
function readerViaDb(bausteine) {
  const pairs = new Set();
  const dateien = [];
  const lauf = d => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) lauf(p);
      else if (n.endsWith('.ts')) dateien.push(p);
    }
  };
  for (const d of [
    path.join(ROOT, 'src'),
    path.join(ROOT, 'jobs'),
    path.join(ROOT, 'routes'),
    path.join(ROOT, 'startup'),
  ])
    lauf(d);
  for (const p of dateien) {
    const datei = path.relative(ROOT, p).split(path.sep).join('/');
    const b = datei === 'src/services.ts' ? datei : areaOf(datei);
    const s = fs.readFileSync(p, 'utf8');
    for (const m of s.matchAll(/^import\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'(?:\.\.?\/)+db\/(\w+)'/gm)) {
      const component = bausteine[m[2]];
      if (!component) continue;
      const namen = m[1].startsWith('*')
        ? Object.keys(component)
        : m[1]
            .slice(1, -1)
            .split(',')
            .map(
              x =>
                x
                  .trim()
                  .replace(/^type\s+/, '')
                  .split(/\s+as\s+/)[0],
            )
            .filter(Boolean);
      for (const name of namen) for (const t of component[name] ?? []) pairs.add(`${b} → ${t}`);
    }
  }
  return [...pairs].sort();
}

const MARKE = 'zzmarke7q';

/** File → written tables, without comments; `DO UPDATE SET` is not a table name. */
function writingPlaces() {
  const tabellen = new Map(),
    dynamisch = new Set();
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'migrations', 'altbestand', 'public', 'docs', 'scripts'].includes(n))
          lauf(p);
        continue;
      }
      if (!n.endsWith('.ts')) continue;
      const datei = path.relative(ROOT, p).split(path.sep).join('/');
      const s = ohneKommentare(fs.readFileSync(p, 'utf8'));
      const muster =
        /\b(?:INSERT INTO|DELETE FROM|TRUNCATE(?: TABLE)?)\s+([a-z_][a-z0-9_]*|\$\{)|(?<!DO )\bUPDATE\s+([a-z_][a-z0-9_]*|\$\{)[^;`'"]*?\bSET\b/g;
      for (const m of s.matchAll(muster)) {
        const t = m[1] ?? m[2];
        if (t === '${') dynamisch.add(datei);
        else (tabellen.get(t) ?? tabellen.set(t, new Set()).get(t)).add(datei);
      }
    }
  })(ROOT);
  return { tabellen, dynamisch };
}

test('shared tables', { concurrency: 1, timeout: 120_000 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  importWorker(t, _req);
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('every table without user_id is in the list', async () => {
    const ohne = (
      await db.all(`
      SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind IN ('r', 'p') AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)`)
    ).map(z => z.t);
    assert.ok(ohne.length > 30, `nur ${ohne.length} Tabellen gefunden — greift die Abfrage noch?`);
    assert.deepEqual(ohne.sort(), Object.keys(SHARED).sort());
  });

  // Recorded once, for the checks on writers, owners and levels below.
  const gemessen = {};
  await t.test('table names at runtime: measured as registered', async () => {
    const bekannt = new Set(Object.values(BESITZER).flat());
    const dateien = filesWithNamesToRuntime();
    assert.ok(dateien.length > 5, `nur ${dateien.length} Dateien — greift die Suche noch?`);
    for (const d of dateien) gemessen[d] = await measureFile(d, bekannt);
    assert.deepEqual(gemessen, DYNAMISCH, 'Neue Datei oder neue Tabelle zur Laufzeit: in DYNAMISCH eintragen');
  });

  await t.test('every writing site on a catalog table is registered', () => {
    const { tabellen, dynamisch } = writingPlaces();
    assert.ok(tabellen.size > 40, `nur ${tabellen.size} Tabellen beschrieben — greift die Suche noch?`);
    assert.ok(dynamisch.size > 0, 'Selbstbeweis: Schreibstellen mit Namen zur Laufzeit werden erkannt');
    assert.deepEqual(
      [...dynamisch].filter(d => !gemessen[d]),
      [],
      'Schreibstelle mit Namen zur Laufzeit ohne Messung',
    );
    for (const [d, { schreibt }] of Object.entries(gemessen))
      for (const name of schreibt) (tabellen.get(name) ?? tabellen.set(name, new Set()).get(name)).add(d);
    const ist = {},
      soll = {};
    for (const [name, e] of Object.entries(SHARED)) {
      if (e.type !== KATALOG) continue;
      ist[name] = [...(tabellen.get(name) ?? [])].sort();
      soll[name] = [...e.schreiber].sort();
    }
    assert.deepEqual(
      ist,
      soll,
      'Eine Katalogtabelle bekommt einen neuen Schreiber: Kommt der Wert aus einer ' +
        'geprüften Quelle, hier eintragen; ist es eine Eingabe, gehört sie in eine Tabelle des Kontos.',
    );
  });

  await t.test('every table has an owner, only it writes into it', async () => {
    const alle = (
      await db.all(`SELECT c.relname AS t FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relkind IN ('r', 'p')`)
    ).map(z => z.t);
    const besitzer = new Map(Object.entries(BESITZER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    const doppelt = Object.values(BESITZER)
      .flat()
      .filter((x, i, a) => a.indexOf(x) !== i);
    assert.deepEqual(doppelt, [], 'Eine Tabelle hat genau einen Besitzer');
    assert.ok(alle.length > 60, `nur ${alle.length} Tabellen gefunden — greift die Abfrage noch?`);
    assert.deepEqual(alle.filter(x => !besitzer.has(x)).sort(), [], 'Tabelle ohne Besitzer: in BESITZER eintragen');
    assert.deepEqual(
      [...besitzer.keys()].filter(x => !alle.includes(x)).sort(),
      [],
      'BESITZER nennt eine Tabelle, die es nicht gibt',
    );
    const fremd = [];
    // Tables outside the schema (copies before migrations, temporary ones) have no owner.
    for (const [tabelle, dateien] of writingPlaces().tabellen)
      for (const d of dateien)
        if (besitzer.has(tabelle) && areaOf(d) !== besitzer.get(tabelle)) fremd.push(`${d} → ${tabelle}`);
    assert.ok(Object.keys(gemessen).length > 5, 'Selbstbeweis: die Messung der Namen zur Laufzeit lief');
    for (const [d, { schreibt }] of Object.entries(gemessen))
      for (const tabelle of schreibt)
        if (areaOf(d) !== besitzer.get(tabelle) && !fremd.includes(`${d} → ${tabelle}`))
          fremd.push(`${d} → ${tabelle}`);
    assert.deepEqual(
      fremd.sort(),
      [...FREMDSCHREIBER].sort(),
      'Schreib-SQL gehört in den Besitzer-Bereich der Tabelle; andere Bereiche rufen dessen Dienst.',
    );
  });

  await t.test('triggers only write into tables of their owner or into justified targets', async () => {
    const besitzer = new Map(Object.entries(BESITZER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    const trigger = await db.all(`SELECT DISTINCT c.relname AS tabelle, p.proname AS funktion, p.prosrc AS quelle
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal`);
    const ziele = new Set(),
      fremd = new Set();
    for (const { tabelle, quelle } of trigger)
      for (const m of quelle.matchAll(/\b(?:INSERT INTO|DELETE FROM|UPDATE)\s+([a-z_][a-z0-9_]*)/g)) {
        ziele.add(m[1]);
        if (besitzer.get(m[1]) !== besitzer.get(tabelle)) fremd.add(`${besitzer.get(tabelle)} → ${m[1]}`);
      }
    assert.ok(ziele.has('parts_version_user'), `Selbstbeweis: Trigger-Ziele ${[...ziele]} — greift die Suche noch?`);
    assert.deepEqual(
      [...fremd].sort(),
      Object.keys(TRIGGER_FREMDZIELE).sort(),
      'Ein Trigger schreibt in die Tabelle eines anderen Bereichs: dem Besitzer zuordnen oder in TRIGGER_FREMDZIELE begründen.',
    );
  });

  await t.test('foreign scopes never read upwards, otherwise fewer tables directly', async () => {
    const besitzer = new Map(Object.entries(BESITZER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    assert.ok(besitzer.size > 60, `nur ${besitzer.size} Tabellen in docs/architecture.md — greift die Suche noch?`);
    const stufen = stufenAusDoku();
    assert.ok(stufen.size > 20, `nur ${stufen.size} Stufen in docs/architecture.md — greift die Suche noch?`);
    const je = { aufwärts: [], katalog: [], abwärts: [] };
    const pairs = new Set(foreignReader(besitzer));
    assert.ok(Object.keys(gemessen).length > 5, 'Selbstbeweis: die Messung der Namen zur Laufzeit lief');
    // What the measurement sees via an imported read building block is counted by the check via db/ below.
    const viaDb = new Set(readerViaDb(await lesebausteine(_req)));
    for (const [d, { liest }] of Object.entries(gemessen))
      for (const tabelle of liest) {
        const paar = `${areaOf(d)} → ${tabelle}`;
        if (besitzer.get(tabelle) !== areaOf(d) && !viaDb.has(paar)) pairs.add(paar);
      }
    for (const paar of [...pairs].sort()) {
      const [b, tabelle] = paar.split(' → ');
      assert.ok(stufen.has(b), `${b} hat keine Stufe`);
      je[readDirection(stufen, b, besitzer.get(tabelle))].push(paar);
    }
    // Self-proof of the classification, on real levels.
    assert.equal(readDirection(stufen, 'src/finances', besitzer.get('sets')), 'aufwärts');
    assert.ok(je.abwärts.includes('src/management → sets'), 'Selbstbeweis: die Verwaltung liest sets direkt');
    assert.ok(je.katalog.length > 10, 'Selbstbeweis: Katalogtabellen werden gelesen');
    assert.deepEqual(
      je.aufwärts,
      [],
      'Ein tieferer Bereich liest die Tabelle eines höheren: Form im eigenen Lesevertrag nennen, SQL über src/services.ts reichen.',
    );
    for (const [type, limit] of [
      ['katalog', KATALOG_LESER_HOECHSTENS],
      ['abwärts', ABWAERTS_LESER_HOECHSTENS],
    ]) {
      assert.ok(
        je[type].length <= limit,
        `${je[type].length} direkte Lesestellen (${type}), erlaubt sind ${limit}.\n${je[type].join('\n')}`,
      );
      if (je[type].length < limit)
        console.log(`  ℹ fremde Leser (${type}): ${je[type].length} (Schranke ${limit}) — Schranke nachziehen`);
    }
  });

  await t.test('not even via db/ does a scope read the table of a higher one', async () => {
    const besitzer = new Map(Object.entries(BESITZER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    const stufen = stufenAusDoku();
    const bausteine = await lesebausteine(_req);
    // Self-proof: what the building blocks read comes from their result, also via constants.
    assert.deepEqual(bausteine.inventoryView?.setBestand, ['sets'], 'setBestand liest sets');
    assert.deepEqual(bausteine.accessView?.familieLebt, ['api_tokens']);
    assert.ok(bausteine.inventoryView?.setZaehlt?.includes('price_alerts'), 'setZaehlt liest über ZAEHLT');
    assert.ok(bausteine.stockQuantity?.quantityOfSets?.includes('sets'), 'asynchrone Bausteine zählen');
    const reader = readerViaDb(bausteine);
    assert.ok(reader.includes('src/sets → set_acquisitions'), 'Selbstbeweis: sets liest eigene Käufe über db/');
    assert.ok(reader.includes('src/services.ts → price_alerts'), 'Selbstbeweis: `* as` zählt alle Exporte');
    const aufwaerts = reader.filter(paar => {
      const [b, tabelle] = paar.split(' → ');
      assert.ok(stufen.has(b), `${b} hat keine Stufe`);
      return besitzer.has(tabelle) && stufen.get(besitzer.get(tabelle)) > stufen.get(b);
    });
    assert.deepEqual(
      aufwaerts,
      [],
      'Ein Bereich liest über db/ aufwärts: die Form in seinen Lesevertrag (src/<bereich>/lesevertrag.ts), den Baustein über src/services.ts reichen.',
    );
  });

  await t.test('input of an account lands in no shared table', async () => {
    const neu = async name =>
      (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
    const A = await neu('anna'),
      B = await neu('bruno');
    await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3003','Brick 2 x 2')`);
    await db.run(
      `INSERT INTO minifigs_catalog (fig_number, fig_name, image_url) VALUES ('fig-000001','Han','https://cdn.rebrickable.com/f.jpg')`,
    );
    await db.run(`INSERT INTO rb_colors (id, name, bl_color_id) VALUES (4,'Red',5)`);

    const { addManualPart } = _req('src/parts/manualParts.js');
    const { addManualMinifig, updateManualMinifig, importMinifigsCsv } = _req('src/minifigs/manualMinifigs.js');
    const bild = `https://cdn.rebrickable.com/${MARKE}.png`;
    await asAccount(A, async () => {
      await addManualPart(A, {
        part_number: '3005',
        color_id: 4,
        part_name: `${MARKE} Teil`,
        color_name: MARKE,
        category_name: MARKE,
        image_url: bild,
        quantity: 1,
        unit_price: 1,
      });
      await addManualMinifig(A, {
        fig_number: 'fig-000002',
        fig_name: `${MARKE} Figur`,
        image_url: bild,
        bl_fig_number: `${MARKE}1`,
        quantity: 1,
        unit_price: 1,
      });
    });
    await asAccount(B, async () => {
      await addManualMinifig(B, { fig_number: 'fig-000001', quantity: 1, unit_price: 1 });
      await updateManualMinifig(B, 'fig-000001', { bl_fig_number: `${MARKE}2` });
      await importMinifigsCsv(B, `fig_number,fig_name,bl_fig_number,quantity\nfig-000003,${MARKE} csv,${MARKE}3,1\n`);
    });

    const srv = testServer(_req, { sitzung: { userId: A }, t });
    const fd = new FormData();
    fd.append(
      'file',
      new Blob(
        [
          `<?xml version="1.0"?><INVENTORY>
      <ITEM><ITEMTYPE>M</ITEMTYPE><ITEMID>${MARKE}4</ITEMID><MINQTY>1</MINQTY></ITEM>
      <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${MARKE}5</ITEMID><COLOR>5</COLOR><MINQTY>1</MINQTY></ITEM></INVENTORY>`,
        ],
        { type: 'text/xml' },
      ),
      'w.xml',
    );
    fd.append(
      'korrekturen',
      JSON.stringify([
        { index: 0, blId: `${MARKE}4`, art: 'fig', rbId: 'fig-000001' },
        { index: 1, blId: `${MARKE}5`, art: 'part', rbId: '3003', rbFarbe: 4 },
      ]),
    );
    const r = await fetch(`${srv.base}/api/v1/wanted-list/import/xml?schreiben=1`, { method: 'POST', body: fd });
    const bericht = await r.json();
    assert.equal(bericht.korrekturen?.angewandt, 2, JSON.stringify(bericht));

    const befallen = [];
    for (const [name, e] of Object.entries(SHARED)) {
      if (e.eingabe !== false) continue;
      const n = (await db.get(`SELECT count(*)::int AS n FROM ${name} x WHERE x::text LIKE $1`, [`%${MARKE}%`])).n;
      if (n) befallen.push(`${name} (${n})`);
    }
    assert.deepEqual(befallen, []);
    // Counterpart: the inputs stand with the accounts, otherwise the search above would check nothing.
    const eigen = await db.get(`SELECT
      (SELECT count(*) FROM bl_mapping_custom e WHERE e::text LIKE '%${MARKE}%')::int AS bl,
      (SELECT count(*) FROM minifig_custom e WHERE e::text LIKE '%${MARKE}%')::int AS fig,
      (SELECT count(*) FROM part_custom e WHERE e::text LIKE '%${MARKE}%')::int AS teil`);
    assert.deepEqual(eigen, { bl: 5, fig: 2, teil: 1 });
  });
});
