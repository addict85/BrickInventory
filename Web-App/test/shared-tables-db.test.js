/**
 * Tables without user_id are shared by all accounts. Which ones they are stands below
 * in SHARED, per table with kind and whether inputs of an account may go in.
 * The tables come from the real schema, the writing places from the
 * source text (a new place on a catalog table must be registered here …
 *
 * Counter-checks (measured on 04.11.2026, one change each, reverted afterwards):
 *   A  routes/api/wanted.ts: rememberNumber always writes rememberBlNumber →
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
 *   O  setHoldings in db/inventoryView.ts reads `FROM parts` → red at the self-proof „setHoldings liest
 *      sets“; if it assembles the name at runtime, it stays green: the result is what is counted.
 *
 * If a file chooses the table name at runtime, what counts is what it reads and writes when called via a recording
 * access (DYNAMIC, measureFile). Counter-checks (measured 15.11.2026, each on its own):
 *   P  src/inventory/repository/storageLocation.ts: TABELLEN.set = 'instructions' → red: “measured as
 *      registered”, “only it writes into it” ['…/lagerort.ts → instructions'] and “never read
 *      upwards” ['src/inventory → instructions']; the regex on literal names saw neither
 *   Q  cacheNumbers() in src/catalog/repository/catalogCache.ts again counts zaehle('price_cache') →
 *      red: “measured as registered” and “never read upwards” ['src/catalog → price_cache']
 *   R  src/wanted/repository/wanted.ts again reads `FROM sets s` instead of setHoldings() → red:
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
const { buildAndRequire, withoutComments, testData, asAccount, testSources } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { importWorker } = require('./helpers/jobs');
const db = testData();
const { testServer } = require('./helpers/server');

// Without network: Rebrickable knows nothing (testSources), then only the input itself remains.
testSources(null, {
  lookupPart: async () => null,
  getMinifigInfo: async () => null,
  setDetails: async () => null,
});

const CATALOG = 'katalog'; // verified sources (Rebrickable, BrickLink, Brickset, ECB)
const OPERATIONS = 'betrieb'; // state of the server, no details about parts
const ACCOUNT = 'account_id'; // belongs to an account via another key

/** type, eingabe (false or why inputs may go in), schreiber (catalog only). */
const SHARED = {
  bl_mapping: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/blMapping.ts'] },
  catalog_cache: {
    type: CATALOG,
    eingabe: false,
    writer: ['src/catalog/repository/catalogCache.ts', 'src/catalog/repository/rebrickableCache.ts'],
  },
  set_catalog: {
    type: CATALOG,
    eingabe: false,
    writer: [
      'src/catalog/repository/imageState.ts',
      'src/catalog/repository/csvSwap.ts',
      'src/catalog/repository/setMaster.ts',
      'src/catalog/repository/partsEnrichment.ts',
    ],
  },
  part_catalog: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/catalogMaster.ts'] },
  part_color_catalog: {
    type: CATALOG,
    eingabe: false,
    writer: [
      'src/catalog/repository/csvCatalog.ts',
      'src/catalog/repository/catalogMaster.ts',
      'src/catalog/repository/partsEnrichment.ts',
    ],
  },
  minifigs_catalog: {
    type: CATALOG,
    eingabe: false,
    writer: ['src/catalog/repository/catalogMaster.ts', 'src/catalog/repository/partsEnrichment.ts'],
  },
  set_parts: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/catalogMaster.ts'] },
  set_minifigs: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/catalogMaster.ts'] },
  subsets_cache: {
    type: CATALOG,
    eingabe: false,
    writer: ['src/catalog/repository/catalogCache.ts', 'src/catalog/repository/rebrickableCache.ts'],
  },
  minifig_parts_cache: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/rebrickableCache.ts'] },
  shared_instructions: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/instructions.ts'] },
  rb_colors: {
    type: CATALOG,
    eingabe: false,
    writer: ['src/catalog/repository/blMapping.ts', 'src/catalog/repository/csvSwap.ts'],
  },
  rb_inventories: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/csvSwap.ts'] },
  rb_inventory_minifigs: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/csvSwap.ts'] },
  rb_inventory_parts: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/csvSwap.ts'] },
  rb_part_categories: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/csvSwap.ts'] },
  rb_parts: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/csvSwap.ts'] },
  rb_sets: {
    type: CATALOG,
    eingabe: false,
    writer: [
      'src/catalog/repository/imageState.ts',
      'src/catalog/repository/csvSwap.ts',
      'src/catalog/repository/setMaster.ts',
    ],
  },
  rb_themes: { type: CATALOG, eingabe: false, writer: ['src/catalog/repository/csvSwap.ts'] },
  price_cache: { type: CATALOG, eingabe: false, writer: ['src/finances/repository/priceCache.ts'] },
  price_history: {
    type: CATALOG,
    eingabe: false,
    writer: [
      'src/finances/repository/priceCache.ts',
      'src/finances/repository/priceRun.ts',
      'src/finances/repository/priceHistory.ts',
    ],
  },
  part_price_cache: { type: CATALOG, eingabe: false, writer: ['src/finances/repository/priceCache.ts'] },
  part_price_history: { type: CATALOG, eingabe: false, writer: ['src/finances/repository/priceCache.ts'] },
  minifig_price_cache: {
    type: CATALOG,
    eingabe: false,
    writer: ['src/finances/repository/marketPrices.ts', 'src/finances/repository/priceCache.ts'],
  },
  minifig_price_history: {
    type: CATALOG,
    eingabe: false,
    writer: ['src/finances/repository/marketPrices.ts', 'src/finances/repository/priceCache.ts'],
  },
  exchange_rates: { type: CATALOG, eingabe: false, writer: ['src/finances/repository/exchangeRates.ts'] },
  image_misses: { type: OPERATIONS, eingabe: false },
  image_wanted: { type: OPERATIONS, eingabe: false },
  parts_catalog_pending: {
    type: OPERATIONS,
    eingabe: 'Nummern, deren Teile-Zusammenfassung nachzuziehen ist; sie ändern keine Angabe',
  },
  api_cadence: { type: OPERATIONS, eingabe: false },
  job_pauses: { type: OPERATIONS, eingabe: false },
  job_exclusive_locks: { type: OPERATIONS, eingabe: false },
  job_types: { type: OPERATIONS, eingabe: false },
  run_state: { type: OPERATIONS, eingabe: false },
  schema_migrations: { type: OPERATIONS, eingabe: false },
  global_settings: { type: OPERATIONS, eingabe: 'nur Verwalter (requireAdmin)' },
  app_logs: { type: OPERATIONS, eingabe: 'Protokollzeilen nennen Eingaben, steuern aber nichts' },
  rate_limit_attempts: { type: OPERATIONS, eingabe: 'Schlüssel aus Benutzername und Adresse der Anmeldebremse' },
  users: { type: ACCOUNT, eingabe: 'Zeile des Kontos (id)' },
  user_sessions: { type: ACCOUNT, eingabe: 'Sitzung eines Kontos (sess.userId)' },
  account_links: { type: ACCOUNT, eingabe: 'Haushalt (main_user_id, sub_user_id)' },
  account_link_invites: { type: ACCOUNT, eingabe: 'Einladung des Hauptkontos (main_user_id)' },
  household_former_links: { type: ACCOUNT, eingabe: 'frühere Haushalte (main_user_id, sub_user_id)' },
  api_calls: { type: ACCOUNT, eingabe: 'Zähler je Konto (account_id)' },
  voucher_balance_throttle: { type: ACCOUNT, eingabe: 'je Gutschein (id = vouchers.id)' },
  admin_log: { type: ACCOUNT, eingabe: 'Handlungen der Verwalter (admin_id)' },
  admin_takeovers: { type: ACCOUNT, eingabe: 'angekündigte Änderung an einem Verwalterkonto (target_id)' },
};

/** Files that choose a table name at runtime (not via the read contract `l.`): what they
 * read and write, measured (measureFile). If it stands here, the measurement is complete; owners
 * and levels apply to what is measured as to literal names. */
const DYNAMIC = {
  'src/inventory/repository/acquisitions.ts': {
    reads: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    writes: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/inventory/repository/shared.ts': {
    reads: [
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
    writes: ['minifigs', 'parts', 'set_acquisitions', 'sets'],
  },
  'src/inventory/repository/purchases.ts': {
    reads: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    writes: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/inventory/repository/purchaseAcquisitions.ts': {
    reads: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    writes: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/inventory/repository/storageLocation.ts': {
    reads: ['minifigs', 'parts', 'sets', 'storage_locations', 'users'],
    writes: ['minifigs', 'parts', 'sets', 'storage_locations'],
  },
  'src/inventory/repository/manualQuantities.ts': {
    reads: ['minifig_acquisitions', 'part_acquisitions'],
    writes: ['minifig_acquisitions', 'part_acquisitions'],
  },
  'src/inventory/repository/trash.ts': {
    reads: [
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
    writes: ['minifig_acquisitions', 'minifigs', 'part_acquisitions', 'parts', 'set_acquisitions', 'sets', 'trash'],
  },
  'src/inventory/repository/reassign.ts': {
    reads: ['minifig_acquisitions', 'minifigs', 'part_acquisitions', 'parts'],
    writes: ['minifig_acquisitions', 'minifigs', 'part_acquisitions', 'parts'],
  },
  'src/finances/repository/priceHistory.ts': {
    reads: [
      'minifig_price_cache',
      'minifig_price_history',
      'part_price_cache',
      'part_price_history',
      'price_cache',
      'price_history',
    ],
    writes: ['price_history'],
  },
  'src/vouchers/repository/vouchers.ts': { reads: ['vouchers'], writes: ['vouchers'] },
  'src/catalog/repository/csvSwap.ts': {
    reads: [
      'rb_colors',
      'rb_inventories',
      'rb_inventory_minifigs',
      'rb_inventory_parts',
      'rb_part_categories',
      'rb_parts',
      'rb_sets',
      'rb_themes',
    ],
    writes: [
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
    reads: ['catalog_cache', 'rb_sets', 'set_catalog', 'subsets_cache'],
    writes: ['catalog_cache', 'subsets_cache'],
  },
  'src/catalog/repository/partsEnrichment.ts': {
    reads: [
      'bl_mapping',
      'minifigs_catalog',
      'part_color_catalog',
      'rb_inventories',
      'rb_inventory_parts',
      'set_catalog',
    ],
    writes: ['minifigs_catalog', 'part_color_catalog', 'set_catalog'],
  },
  'src/sets/repository/sets.ts': {
    reads: [
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
    writes: [],
  },
};

const WRITE =
  /\b(?:INSERT INTO|DELETE FROM|TRUNCATE(?: TABLE)?)\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)|(?<!DO )\bUPDATE\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)[^;`'"]*?\bSET\b/g;
const READS = /\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\b/g;
const NAME_AT_RUNTIME =
  /\b(?:FROM|JOIN|USING|INSERT INTO|DELETE FROM|UPDATE|TRUNCATE(?: TABLE)?)\s+(?:ONLY\s+)?\$\{\s*([\w$]+)(\s*[.[(])?/g;

/** Files under src/ whose SQL takes a table name from an own variable. Exempt:
 * the read contract (`l.…`) and read building blocks from db/, whose result the check measures via db/. */
function filesWithNamesToRuntime() {
  const out = [];
  (function run(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) run(p);
      else if (n.endsWith('.ts')) {
        const s = withoutComments(fs.readFileSync(p, 'utf8'));
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
        const own = [...s.matchAll(NAME_AT_RUNTIME)].some(
          m => !(m[1] === 'l' && /[.[]/.test(m[2] ?? '')) && !(fromDb.has(m[1]) && (m[2] ?? '').trim() === '('),
        );
        if (own) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
      }
    }
  })(path.join(ROOT, 'src'));
  return out.sort();
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

const KINDS = ['set', 'part', 'fig', 'teil', 'figur'];

/** Calls every export of the file per kind via an access that only records the queries. If the
 * caller chooses the name, then from an exported list of the file: its values are further probes.
 * @returns read and written tables, as far as the schema knows them */
async function measureFile(file, known) {
  const reads = new Set(),
    writes = new Set();
  const c = chamaeleon();
  const remember = sql => {
    for (const m of String(sql).matchAll(READS)) if (known.has(m[1])) reads.add(m[1]);
    for (const m of String(sql).matchAll(WRITE)) if (known.has(m[1] ?? m[2])) writes.add(m[1] ?? m[2]);
  };
  const response = value => async sql => {
    remember(sql);
    return value;
  };
  const access = {
    get: response(c),
    all: response([c]),
    run: response({ changes: 1 }),
    query: response({ rows: [c], rowCount: 1 }),
  };
  const mod = _req(file.replace(/\.ts$/, '.js'));
  const listen = Object.values(mod).filter(Array.isArray).flat();
  const kinds = [...KINDS, ...listen.filter(x => typeof x === 'string')];
  for (const f of Object.values(mod))
    if (typeof f === 'function')
      for (const type of kinds)
        for (const probe of [
          [access, type, c, c, c, c, c, c],
          [access, c, type, c, c, c, c, c],
        ])
          try {
            const r = f(...probe);
            if (r && typeof r.then === 'function') await r.catch(() => {});
          } catch {
            // A probe that does not fit asks nothing.
          }
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

/** Per scope the tables into which only it writes: the table in docs/architecture.md. */
function ownerFromDoc() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## Tabellen und Besitzer'), doc.indexOf('## API-Vertrag'));
  return Object.fromEntries(
    [...section.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map(m => [
      m[1],
      [...m[2].matchAll(/`([^`]+)`/g)].map(x => x[1]),
    ]),
  );
}
const OWNER = ownerFromDoc();

/** Exceptions to „only the owner writes“; a ratchet: only delete, never add. */
const FOREIGN_WRITERS = [
  // The schema start writes the time zone before there are services.
  'db/schemaStart.ts → global_settings',
];

/** Triggers that write into the table of another scope: „owner of the trigger table →
 * target“ and why that does not go via the target's service. A ratchet like FREMDSCHREIBER. */
const TRIGGER_FOREIGN_TARGETS = {
  'src/inventory → parts_version_user':
    'Der Teilezähler muss jede Änderung an Sets, Käufen, Teilen und Lagerorten sehen, auch ohne src/parts',
  'src/catalog → parts_catalog_pending':
    'Katalogänderungen merken nur die Nummer vor; src/parts zieht die Zusammenfassung nach und leert die Liste',
};

/** Do foreign scopes read a table directly (FROM, JOIN, USING) instead of via a read building block
 * in db/ or the owner's service? Pairs „scope → table“; db/ itself is the read building block.
 * Upwards (owner on a higher level) is forbidden; catalog tables are shared master data
 * and are counted separately; the rest reads downwards and may only become fewer. */
const CATALOG_READERS_MAX = 49;
const DOWNSTREAM_READERS_MAX = 24;

/** Per scope its level from docs/architecture.md („Rangfolge der Bereiche“). */
function levelsFromDoc() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## Rangfolge der Bereiche'), doc.indexOf('## Schema'));
  return new Map(
    [...section.matchAll(/^\| (\d+) \| (.+) \|$/gm)].flatMap(m =>
      [...m[2].matchAll(/`([^`]+)`/g)].map(x => [x[1], Number(m[1])]),
    ),
  );
}

/** „aufwärts“, „katalog“ or „abwärts“ for the reader `b` of a table of the owner `owner`. */
function readDirection(levels, b, owner) {
  if (owner === 'src/catalog') return 'katalog';
  return levels.get(owner) > levels.get(b) ? 'aufwärts' : 'abwärts';
}

function foreignReader(ownerName) {
  const pairs = new Set();
  (function run(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) run(p);
      else if (n.endsWith('.ts')) {
        const file = path.relative(ROOT, p).split(path.sep).join('/');
        const b = areaOf(file);
        const s = withoutComments(fs.readFileSync(p, 'utf8'));
        for (const m of s.matchAll(/\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/g))
          if (ownerName.has(m[1]) && ownerName.get(m[1]) !== b) pairs.add(`${b} → ${m[1]}`);
      }
    }
  })(path.join(ROOT, 'src'));
  return [...pairs].sort();
}

const areaOf = file => (file.startsWith('src/') ? file.split('/').slice(0, 2).join('/') : file.split('/')[0]);

const READ = /\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/g;

/** Per read building block in db/ and export the tables its result reads: every function runs with
 * probes per kind and an access that only records the queries. That way what is read via a
 * constant (ZAEHLT) or an asynchronous query counts too. */
async function readingBlocks(_req) {
  const per = {};
  const dir = path.join(ROOT, 'db');
  for (const n of fs.readdirSync(dir)) {
    if (!n.endsWith('.ts') || ['database.ts', 'migrate.ts', 'schemaStart.ts'].includes(n)) continue;
    if (!/\b(?:FROM|JOIN)\b/.test(fs.readFileSync(path.join(dir, n), 'utf8'))) continue;
    const mod = n.replace(/\.ts$/, '');
    per[mod] = {};
    for (const [name, value] of Object.entries(_req(`db/${mod}.js`))) {
      const tables = new Set();
      const remember = sql => {
        for (const m of String(sql).matchAll(READ)) tables.add(m[1]);
      };
      const access = {
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
          const probeList = [
            [],
            ['= ANY($1)'],
            [type, '$1', ['3001', 4], access],
            ['s', type, 'tm', '= ANY($1)'],
            ['$1', '$2', access],
            [1, '3001-1', access],
          ];
          for (const probe of probeList) {
            try {
              const r = value(...probe);
              if (r && typeof r.then === 'function') await r.catch(() => {});
              else remember(r);
            } catch {
              // A probe that does not fit reads nothing.
            }
          }
        }
      if (tables.size) per[mod][name] = [...tables].sort();
    }
  }
  return per;
}

/** Pairs „scope → table“ that a scope reads via imported read building blocks (also `* as`). */
function readerViaDb(bricks) {
  const pairs = new Set();
  const files = [];
  const run = d => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) run(p);
      else if (n.endsWith('.ts')) files.push(p);
    }
  };
  for (const d of [
    path.join(ROOT, 'src'),
    path.join(ROOT, 'jobs'),
    path.join(ROOT, 'routes'),
    path.join(ROOT, 'startup'),
  ])
    run(d);
  for (const p of files) {
    const file = path.relative(ROOT, p).split(path.sep).join('/');
    const b = file === 'src/services.ts' ? file : areaOf(file);
    const s = fs.readFileSync(p, 'utf8');
    for (const m of s.matchAll(/^import\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'(?:\.\.?\/)+db\/(\w+)'/gm)) {
      const component = bricks[m[2]];
      if (!component) continue;
      const names = m[1].startsWith('*')
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
      for (const name of names) for (const t of component[name] ?? []) pairs.add(`${b} → ${t}`);
    }
  }
  return [...pairs].sort();
}

const MARK = 'zzmarke7q';

/** File → written tables, without comments; `DO UPDATE SET` is not a table name. */
function writingPlaces() {
  const tables = new Map(),
    dynamic = new Set();
  (function run(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'migrations', 'altbestand', 'public', 'docs', 'scripts'].includes(n))
          run(p);
        continue;
      }
      if (!n.endsWith('.ts')) continue;
      const file = path.relative(ROOT, p).split(path.sep).join('/');
      const s = withoutComments(fs.readFileSync(p, 'utf8'));
      const pattern =
        /\b(?:INSERT INTO|DELETE FROM|TRUNCATE(?: TABLE)?)\s+([a-z_][a-z0-9_]*|\$\{)|(?<!DO )\bUPDATE\s+([a-z_][a-z0-9_]*|\$\{)[^;`'"]*?\bSET\b/g;
      for (const m of s.matchAll(pattern)) {
        const t = m[1] ?? m[2];
        if (t === '${') dynamic.add(file);
        else (tables.get(t) ?? tables.set(t, new Set()).get(t)).add(file);
      }
    }
  })(ROOT);
  return { tables, dynamic };
}

test('shared tables', { concurrency: 1, timeout: 120_000 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  // Only after the migrations: a worker polling meanwhile locked the tables 0127 renames (deadlock).
  importWorker(t, _req);
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('every table without user_id is in the list', async () => {
    const without = (
      await db.all(`
      SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind IN ('r', 'p') AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)`)
    ).map(z => z.t);
    assert.ok(without.length > 30, `only ${without.length} tables found — does the query still work?`);
    assert.deepEqual(without.sort(), Object.keys(SHARED).sort());
  });

  // Recorded once, for the checks on writers, owners and levels below.
  const measured = {};
  await t.test('table names at runtime: measured as registered', async () => {
    const known = new Set(Object.values(OWNER).flat());
    const files = filesWithNamesToRuntime();
    assert.ok(files.length > 5, `only ${files.length} files — does the search still work?`);
    for (const d of files) measured[d] = await measureFile(d, known);
    assert.deepEqual(measured, DYNAMIC, 'New file or new table at runtime: add it to DYNAMIC');
  });

  await t.test('every writing site on a catalog table is registered', () => {
    const { tables, dynamic } = writingPlaces();
    assert.ok(tables.size > 40, `only ${tables.size} tables written — does the search still work?`);
    assert.ok(dynamic.size > 0, 'self-proof: write sites with names at runtime are recognised');
    assert.deepEqual(
      [...dynamic].filter(d => !measured[d]),
      [],
      'write site with a name at runtime without measurement',
    );
    for (const [d, { writes }] of Object.entries(measured))
      for (const name of writes) (tables.get(name) ?? tables.set(name, new Set()).get(name)).add(d);
    const actual = {},
      want = {};
    for (const [name, e] of Object.entries(SHARED)) {
      if (e.type !== CATALOG) continue;
      actual[name] = [...(tables.get(name) ?? [])].sort();
      want[name] = [...e.writer].sort();
    }
    assert.deepEqual(
      actual,
      want,
      'A catalogue table gets a new writer: if the value comes from a ' +
        'checked source, add it here; if it is an input, it belongs in a table of the account.',
    );
  });

  await t.test('every table has an owner, only it writes into it', async () => {
    const all = (
      await db.all(`SELECT c.relname AS t FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relkind IN ('r', 'p')`)
    ).map(z => z.t);
    const ownerName = new Map(Object.entries(OWNER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    const twice = Object.values(OWNER)
      .flat()
      .filter((x, i, a) => a.indexOf(x) !== i);
    assert.deepEqual(twice, [], 'A table has exactly one owner');
    assert.ok(all.length > 60, `only ${all.length} tables found — does the query still work?`);
    assert.deepEqual(all.filter(x => !ownerName.has(x)).sort(), [], 'table without an owner: add it to OWNER');
    assert.deepEqual(
      [...ownerName.keys()].filter(x => !all.includes(x)).sort(),
      [],
      'OWNER names a table that does not exist',
    );
    const fremd = [];
    // Tables outside the schema (copies before migrations, temporary ones) have no owner.
    for (const [table, files] of writingPlaces().tables)
      for (const d of files)
        if (ownerName.has(table) && areaOf(d) !== ownerName.get(table)) fremd.push(`${d} → ${table}`);
    assert.ok(Object.keys(measured).length > 5, 'self-proof: the measurement of the names at runtime ran');
    for (const [d, { writes }] of Object.entries(measured))
      for (const table of writes)
        if (areaOf(d) !== ownerName.get(table) && !fremd.includes(`${d} → ${table}`)) fremd.push(`${d} → ${table}`);
    assert.deepEqual(
      fremd.sort(),
      [...FOREIGN_WRITERS].sort(),
      "Write SQL belongs in the owner area of the table; other areas call that area's service.",
    );
  });

  await t.test('triggers only write into tables of their owner or into justified targets', async () => {
    const ownerName = new Map(Object.entries(OWNER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    const trigger = await db.all(`SELECT DISTINCT c.relname AS "table", p.proname AS funktion, p.prosrc AS source
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal`);
    const targets = new Set(),
      fremd = new Set();
    for (const { table, source } of trigger)
      for (const m of source.matchAll(/\b(?:INSERT INTO|DELETE FROM|UPDATE)\s+([a-z_][a-z0-9_]*)/g)) {
        targets.add(m[1]);
        if (ownerName.get(m[1]) !== ownerName.get(table)) fremd.add(`${ownerName.get(table)} → ${m[1]}`);
      }
    assert.ok(
      targets.has('parts_version_user'),
      `self-proof: trigger targets ${[...targets]} — does the search still work?`,
    );
    assert.deepEqual(
      [...fremd].sort(),
      Object.keys(TRIGGER_FOREIGN_TARGETS).sort(),
      'A trigger writes into the table of another area: assign it to the owner or justify it in TRIGGER_FREMDZIELE.',
    );
  });

  await t.test('foreign scopes never read upwards, otherwise fewer tables directly', async () => {
    const ownerName = new Map(Object.entries(OWNER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    assert.ok(
      ownerName.size > 60,
      `only ${ownerName.size} tables in docs/architecture.md — does the search still work?`,
    );
    const levels = levelsFromDoc();
    assert.ok(levels.size > 20, `only ${levels.size} levels in docs/architecture.md — does the search still work?`);
    const per = { aufwärts: [], katalog: [], abwärts: [] };
    const pairs = new Set(foreignReader(ownerName));
    assert.ok(Object.keys(measured).length > 5, 'self-proof: the measurement of the names at runtime ran');
    // What the measurement sees via an imported read building block is counted by the check via db/ below.
    const viaDb = new Set(readerViaDb(await readingBlocks(_req)));
    for (const [d, { reads }] of Object.entries(measured))
      for (const table of reads) {
        const pair = `${areaOf(d)} → ${table}`;
        if (ownerName.get(table) !== areaOf(d) && !viaDb.has(pair)) pairs.add(pair);
      }
    for (const pair of [...pairs].sort()) {
      const [b, table] = pair.split(' → ');
      assert.ok(levels.has(b), `${b} has no level`);
      per[readDirection(levels, b, ownerName.get(table))].push(pair);
    }
    // Self-proof of the classification, on real levels.
    assert.equal(readDirection(levels, 'src/finances', ownerName.get('sets')), 'aufwärts');
    assert.ok(per.abwärts.includes('src/management → sets'), 'self-proof: the administration reads sets directly');
    assert.ok(per.katalog.length > 10, 'self-proof: catalogue tables are read');
    assert.deepEqual(
      per.aufwärts,
      [],
      'A lower area reads the table of a higher one: name the shape in its own read contract, pass the SQL via src/services.ts.',
    );
    for (const [type, limit] of [
      ['katalog', CATALOG_READERS_MAX],
      ['abwärts', DOWNSTREAM_READERS_MAX],
    ]) {
      assert.ok(
        per[type].length <= limit,
        `${per[type].length} direct read sites (${type}), allowed are ${limit}.\n${per[type].join('\n')}`,
      );
      if (per[type].length < limit)
        console.log(`  ℹ fremde Leser (${type}): ${per[type].length} (Schranke ${limit}) — Schranke nachziehen`);
    }
  });

  await t.test('not even via db/ does a scope read the table of a higher one', async () => {
    const ownerName = new Map(Object.entries(OWNER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    const levels = levelsFromDoc();
    const bricks = await readingBlocks(_req);
    // Self-proof: what the building blocks read comes from their result, also via constants.
    assert.deepEqual(bricks.inventoryView?.setHoldings, ['sets'], 'setHoldings reads sets');
    assert.deepEqual(bricks.accessView?.familyAlive, ['api_tokens']);
    assert.ok(bricks.inventoryView?.setCounts?.includes('price_alerts'), 'setCounts reads price_alerts via a constant');
    assert.ok(bricks.stockQuantity?.quantityOfSets?.includes('sets'), 'asynchronous building blocks count');
    const reader = readerViaDb(bricks);
    assert.ok(reader.includes('src/sets → set_acquisitions'), 'self-proof: sets reads its own purchases via db/');
    assert.ok(reader.includes('src/services.ts → price_alerts'), 'self-proof: `* as` counts all exports');
    const upward = reader.filter(pair => {
      const [b, table] = pair.split(' → ');
      assert.ok(levels.has(b), `${b} has no level`);
      return ownerName.has(table) && levels.get(ownerName.get(table)) > levels.get(b);
    });
    assert.deepEqual(
      upward,
      [],
      'An area reads upwards via db/: put the shape in its read contract (src/<area>/readContract.ts), pass the building block via src/services.ts.',
    );
  });

  await t.test('input of an account lands in no shared table', async () => {
    const fresh = async name =>
      (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
    const A = await fresh('anna'),
      B = await fresh('bruno');
    await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3003','Brick 2 x 2')`);
    await db.run(
      `INSERT INTO minifigs_catalog (fig_number, fig_name, image_url) VALUES ('fig-000001','Han','https://cdn.rebrickable.com/f.jpg')`,
    );
    await db.run(`INSERT INTO rb_colors (id, name, bl_color_id) VALUES (4,'Red',5)`);

    const { addManualPart } = _req('src/parts/manualParts.js');
    const { addManualMinifig, updateManualMinifig, importMinifigsCsv } = _req('src/minifigs/manualMinifigs.js');
    const image = `https://cdn.rebrickable.com/${MARK}.png`;
    await asAccount(A, async () => {
      await addManualPart(A, {
        part_number: '3005',
        color_id: 4,
        part_name: `${MARK} Teil`,
        color_name: MARK,
        category_name: MARK,
        image_url: image,
        quantity: 1,
        unit_price: 1,
      });
      await addManualMinifig(A, {
        fig_number: 'fig-000002',
        fig_name: `${MARK} Figur`,
        image_url: image,
        bl_fig_number: `${MARK}1`,
        quantity: 1,
        unit_price: 1,
      });
    });
    await asAccount(B, async () => {
      await addManualMinifig(B, { fig_number: 'fig-000001', quantity: 1, unit_price: 1 });
      await updateManualMinifig(B, 'fig-000001', { bl_fig_number: `${MARK}2` });
      await importMinifigsCsv(B, `fig_number,fig_name,bl_fig_number,quantity\nfig-000003,${MARK} csv,${MARK}3,1\n`);
    });

    const srv = testServer(_req, { session: { userId: A }, t });
    const fd = new FormData();
    fd.append(
      'file',
      new Blob(
        [
          `<?xml version="1.0"?><INVENTORY>
      <ITEM><ITEMTYPE>M</ITEMTYPE><ITEMID>${MARK}4</ITEMID><MINQTY>1</MINQTY></ITEM>
      <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${MARK}5</ITEMID><COLOR>5</COLOR><MINQTY>1</MINQTY></ITEM></INVENTORY>`,
        ],
        { type: 'text/xml' },
      ),
      'w.xml',
    );
    fd.append(
      'corrections',
      JSON.stringify([
        { index: 0, blId: `${MARK}4`, kind: 'fig', rbId: 'fig-000001' },
        { index: 1, blId: `${MARK}5`, kind: 'part', rbId: '3003', rbColor: 4 },
      ]),
    );
    const r = await fetch(`${srv.base}/api/v2/wanted-list/import/xml?write=1`, { method: 'POST', body: fd });
    const report = await r.json();
    assert.equal(report.corrections?.applied, 2, JSON.stringify(report));

    const befallen = [];
    for (const [name, e] of Object.entries(SHARED)) {
      if (e.eingabe !== false) continue;
      const n = (await db.get(`SELECT count(*)::int AS n FROM ${name} x WHERE x::text LIKE $1`, [`%${MARK}%`])).n;
      if (n) befallen.push(`${name} (${n})`);
    }
    assert.deepEqual(befallen, []);
    // Counterpart: the inputs stand with the accounts, otherwise the search above would check nothing.
    const own = await db.get(`SELECT
      (SELECT count(*) FROM bl_mapping_custom e WHERE e::text LIKE '%${MARK}%')::int AS bl,
      (SELECT count(*) FROM minifig_custom e WHERE e::text LIKE '%${MARK}%')::int AS fig,
      (SELECT count(*) FROM part_custom e WHERE e::text LIKE '%${MARK}%')::int AS teil`);
    assert.deepEqual(own, { bl: 5, fig: 2, teil: 1 });
  });
});
