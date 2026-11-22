/**
 * The service set (buildServices) is the surface through which areas, routes and jobs
 * call each other. Its keys become fewer, never more: whatever only one area needs
 * itself, it calls through its own functions.
 *
 * Counted on the built set, not in the source text: a key from a spread
 * or a helper function (imageServices in the catalog) thus counts too, a sub-surface
 * (konto.sitzungen.*) with each of its services. The access is a stub; the
 * build does not query the database.
 *
 * Counter-checks (15.11.2026):
 *   B  in src/vouchers/area.ts `batchCreate` back into the set → red „Zahl
 *      der Dienstschlüssel“
 *   C  in src/parts/area.ts `readParts` again `partsList` (like the repository in the
 *      context) → red „Dienst heisst wie ein Teil des Kontexts“ (parts.partsList)
 *   D  `setzeAktiv: mit(k)(accountsService.setzeAktiv)` back in src/account/area.ts → red
 *      „Zahl der Dienstschlüssel“ (547, allowed 546)
 *   E  in routes/auth/secondFactor.ts `d.factors.renewCodes` replaced by a
 *      placeholder → red „ohne Aufrufer“ (factors.renewCodes)
 *   F  JE_AREA.konto set to 88 → red „Schlüssel je Bereich“ (konto 89, allowed 88)
 *
 * Raw pass-throughs (a service is the repository itself, k.repo.f or mit(k.db, repo.f)):
 * Counter-checks (15.11.2026):
 *   G  `validToken: k.zugaenge.validToken` back in src/account/area.ts → red „Zahl
 *      der Dienstschlüssel“ (538, allowed 537) and „roh weiterreichen“ (konto.validToken)
 *   H  'catalog.catalogStatus' deleted from RAW_ALLOWED → red „roh weiterreichen“ (the form
 *      mit(k.db, setMaster.catalogStatus), recognized via the build as a repository function)
 *   I  JE_AREA.factors set to 17 → red „Schlüssel je Bereich“ (factors 18, allowed 17)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildAndRequire, ROOT, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();

/** A set of services over an access that answers nothing; `contexts` takes up the contexts. */
function satz(contexts = undefined) {
  const stummel = {
    inTransaction: () => false,
    transaction: async () => {
      throw new Error('Der Bau fragt nicht');
    },
  };
  return _req('startup/wiring.js').buildServices(stummel, { contexts });
}

/** The clients of the external sources are not a service but its content; they count as one. */
const GANZ = new Set(['sources', 'drossel']);

/** Every service as `bereich.name` or `bereich.teil.name`. */
function leaves(x, ago) {
  return Object.entries(/** @type {Record<string, unknown>} */ (x)).flatMap(([n, v]) => {
    if (n === 'over') return [];
    const teil = v && typeof v === 'object' && !GANZ.has(n) && Object.values(v).some(w => typeof w === 'function');
    return teil ? leaves(v, `${ago}.${n}`) : [`${ago}.${n}`];
  });
}

/** At most this many per area; a new service displaces an old one. */
const JE_AREA = {
  throttle: 11, // the API budget (api_budget) moved here from process memory; vouchers gave up two
  settings: 22,
  mail: 13,
  jobQueue: 65,
  household: 20,
  devices: 6,
  factors: 18,
  account: 65,
  profile: 3,
  idempotency: 8,
  externalSources: 12,
  images: 29,
  catalog: 64,
  finances: 36,
  inventory: 43, // with the write paths that sets, parts and figuren handed over (table ownership)
  sets: 41,
  parts: 13,
  minifigs: 8,
  wanted: 9,
  vouchers: 15,
  collection: 8,
  management: 28,
};

/** Source text outside the tests, without comments, per file (path from ROOT). */
function sources() {
  const aus = new Map();
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', '.git', 'coverage', 'test', 'public', 'docs', 'frontend-types'].includes(n))
          lauf(p);
      } else if (n.endsWith('.ts'))
        aus.set(path.relative(ROOT, p).split(path.sep).join('/'), ohneKommentare(fs.readFileSync(p, 'utf8')));
    }
  })(ROOT);
  return aus;
}

test('service keys become fewer, never more, and each has a caller', () => {
  /** @type {Record<string, any>} */
  const contexts = {};
  const d = satz(contexts);
  const schluessel = Object.entries(d).flatMap(([b, x]) => leaves(x, b));
  assert.ok(Object.keys(d).length > 15, `nur ${Object.keys(d).length} Bereiche gebaut`);
  assert.ok(schluessel.length > 300, `nur ${schluessel.length} Dienstschlüssel — greift die Zählung noch?`);
  assert.ok(schluessel.includes('account.sitzungen.endOther'), 'Selbstbeweis: Teilflächen zählen je Dienst');

  const LIMIT_NUMBER = 537;
  assert.ok(
    schluessel.length <= LIMIT_NUMBER,
    `Zahl der Dienstschlüssel: ${schluessel.length}, erlaubt ${LIMIT_NUMBER}`,
  );
  if (schluessel.length < LIMIT_NUMBER)
    console.log(`  ℹ Dienstschlüssel: ${schluessel.length} (Schranke ${LIMIT_NUMBER}) — nachziehen`);
  const je = {};
  for (const s of schluessel) je[s.split('.')[0]] = (je[s.split('.')[0]] ?? 0) + 1;
  const toMuch = Object.entries(je)
    .filter(([b, n]) => !(b in JE_AREA) || n > JE_AREA[b])
    .map(([b, n]) => `${b} ${n}, erlaubt ${JE_AREA[b] ?? 'keine Schranke'}`);
  assert.deepEqual(toMuch, [], 'Schlüssel je Bereich');

  // testArea() and every reader would otherwise take the service where the repository is meant.
  const gleich = schluessel.filter(s => {
    const [b = '', k = ''] = s.split('.');
    return typeof contexts[b]?.[k] === 'object' && contexts[b][k] !== null;
  });
  assert.deepEqual(gleich, [], 'Dienst heisst wie ein Teil des Kontexts');

  // Called via the set (`d.account.…`, `k.konto.…`) or named in Pick<…>; the factory of the area does not count.
  const q = sources();
  const ohne = schluessel.filter(s => {
    const name = s.split('.').at(-1);
    const muster = new RegExp(`[.?]\\s*${name}\\b|['"]${name}['"]`);
    const b = s.split('.')[0];
    const factory = ['bereich.ts', 'area.ts'].map(f => `src/${b}/${f}`).find(f => q.has(f)) ?? `src/${b}/bereich.ts`;
    return ![...q].some(([datei, text]) => datei !== factory && muster.test(text));
  });
  assert.deepEqual(ohne, [], 'Schlüssel ohne Aufrufer ausserhalb der Tests');
});

/** Services that pass a repository through raw, with a reason; the list gets shorter, never longer. */
const RAW_ALLOWED = {
  'jobQueue.claimJob': 'Pacht des Workers (jobs/jobWorker.ts): die Regel steht im SQL der Warteschlange',
  'jobQueue.giveBack': 'Pacht des Workers (jobs/jobWorker.ts): die Regel steht im SQL der Warteschlange',
  'jobQueue.heartbeat': 'Pacht des Workers (jobs/jobWorker.ts): die Regel steht im SQL der Warteschlange',
  'jobQueue.rememberExclusive': 'Pacht des Workers (jobs/jobWorker.ts): die Regel steht im SQL der Warteschlange',
  'jobQueue.lastPerKind': 'Kacheln der Verwaltung: je Art die letzte Zeile, so wie sie steht',
  'jobQueue.cleanCompletedOn': 'Aufräumlauf: Frist und Regel stehen in der Abfrage',
  'jobQueue.liesPause': 'Pause einer Art (CDN, Brickset): Frist und Grund setzt der Aufrufer',
  'jobQueue.pauseKind': 'Pause einer Art (CDN, Brickset): Frist und Grund setzt der Aufrufer',
  'jobQueue.readState': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'jobQueue.deleteState': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'jobQueue.setState': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'jobQueue.countState': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'throttle.hourlyState': 'Guthabenschranke: prüft und zählt in der Transaktion von src/vouchers',
  'throttle.countHour': 'Guthabenschranke: prüft und zählt in der Transaktion von src/vouchers',
  'sets.setsOfAccount': 'Setnummern eines Kontos für das Löschen der Sammlung (src/collection), ohne Regel davor',
  'finances.marketPriceFromCache':
    'Rückfall der Set-Bewertung (src/sets/service.ts) auf den Zwischenspeicher, ohne Regel',
  'finances.marketPriceFromHistory': 'Rückfall der Set-Bewertung (src/sets/service.ts) auf den Verlauf, ohne Regel',
  'throttle.claimApiBudget': 'API-Budget (src/http/apiThrottle.ts): die Regel steht im SQL des Upserts',
  'catalog.catalogStatus':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
  'catalog.rememberCatalogPlaceholder':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
  'catalog.rememberSetCatalog':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
};

/** Per area the functions of its repositories, as the build loads them. */
function repositoryFunctions(b, q) {
  const raus = new Set();
  for (const rel of q.keys())
    if (rel.startsWith(`src/${b}/repository/`) || rel === `src/${b}/repository.ts`)
      for (const f of Object.values(_req(rel.replace(/\.ts$/, '.js')))) if (typeof f === 'function') raus.add(f);
  return raus;
}

/** `name: mit(k.db, modul.f)` in the factory, with f from a repository of the area. */
function boundRepositories(b, leavesOfArea, q) {
  const factory = q.get(`src/${b}/bereich.ts`) ?? q.get(`src/${b}/area.ts`);
  if (!factory) return [];
  const repo = repositoryFunctions(b, q);
  const raus = [];
  for (const m of factory.matchAll(/^\s*(\w+): bound\(\w+\.db,\s*(\w+)\.(\w+)\)/gm)) {
    const imp = new RegExp(`import \\* as ${m[2]} from '\\./([^']+)'`).exec(factory);
    const f = imp && _req(`src/${b}/${imp[1]}.js`)[m[3]];
    if (f && repo.has(f)) raus.push(...leavesOfArea.filter(s => s.endsWith(`.${m[1]}`)));
  }
  return raus;
}

test('no service key passes a repository through raw', () => {
  /** @type {Record<string, any>} */
  const contexts = {};
  const d = satz(contexts);
  const q = sources();
  const roh = new Set();
  for (const [b, x] of Object.entries(d)) {
    const leavesOfArea = leaves(x, b);
    // The same function value as in the context (k.repo.f, ...k.repo): the service is the repository.
    const inContext = new Set(
      Object.entries(contexts[b] ?? {})
        .filter(([n, teil]) => n !== 'db' && teil && typeof teil === 'object')
        .flatMap(([, teil]) => Object.values(teil).filter(f => typeof f === 'function')),
    );
    for (const s of leavesOfArea) {
      const f = s
        .split('.')
        .slice(1)
        .reduce((o, n) => o?.[n], x);
      if (typeof f === 'function' && inContext.has(f)) roh.add(s);
    }
    for (const s of boundRepositories(b, leavesOfArea, q)) roh.add(s);
  }
  assert.ok(roh.has('jobQueue.readState') && roh.has('catalog.catalogStatus'), 'Selbstbeweis: beide Formen gefunden');
  assert.deepEqual(
    [...roh].sort(),
    Object.keys(RAW_ALLOWED).sort(),
    'Dienstschlüssel, die ein Repository roh weiterreichen',
  );
  const LIMIT_RAW = 21;
  assert.ok(roh.size <= LIMIT_RAW, `${roh.size} rohe Weitergaben, erlaubt ${LIMIT_RAW}`);
});
