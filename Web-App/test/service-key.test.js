/**
 * The service set (buildServices) is the surface through which areas, routes and jobs
 * call each other. Its keys become fewer, never more: whatever only one area needs
 * itself, it calls through its own functions.
 *
 * Gezählt wird am gebauten Satz, nicht im Quelltext: Ein Schlüssel aus einem Spread
 * oder einer Hilfsfunktion (imageServices im Katalog) zählt so mit, eine Teilfläche
 * (konto.sitzungen.*) mit jedem ihrer Dienste. Der Zugang ist ein Stummel; der
 * Bau fragt die Datenbank nicht.
 *
 * Gegenproben (15.11.2026):
 *   B  in src/vouchers/area.ts `batchCreate` wieder in den Satz → rot „Zahl
 *      der Dienstschlüssel“
 *   C  in src/parts/area.ts `readParts` wieder `partsList` (wie das Repository im
 *      Kontext) → rot „Dienst heisst wie ein Teil des Kontexts“ (parts.partsList)
 *   D  `setzeAktiv: mit(k)(accountsService.setzeAktiv)` zurück in src/account/area.ts → rot
 *      „Zahl der Dienstschlüssel“ (547, erlaubt 546)
 *   E  in routes/auth/secondFactor.ts `d.factors.renewCodes` durch einen
 *      Platzhalter ersetzt → rot „ohne Aufrufer“ (factors.renewCodes)
 *   F  JE_AREA.konto auf 88 → rot „Schlüssel je Bereich“ (konto 89, erlaubt 88)
 *
 * Rohe Weitergaben (ein Dienst ist das Repository selbst, k.repo.f oder mit(k.db, repo.f)):
 * Gegenproben (15.11.2026):
 *   G  `validToken: k.zugaenge.validToken` zurück in src/account/area.ts → rot „Zahl
 *      der Dienstschlüssel“ (538, erlaubt 537) und „roh weiterreichen“ (konto.validToken)
 *   H  'catalog.catalogStatus' aus RAW_ALLOWED gestrichen → rot „roh weiterreichen“ (die Form
 *      mit(k.db, setStamm.catalogStatus), über den Bau als Repository-Funktion erkannt)
 *   I  JE_AREA.factors auf 17 → rot „Schlüssel je Bereich“ (factors 18, erlaubt 17)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildAndRequire, ROOT, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();

/** Ein Satz Dienste über einem Zugang, der nichts beantwortet; `contexts` nimmt die Kontexte auf. */
function satz(contexts = undefined) {
  const stummel = {
    inTransaction: () => false,
    transaction: async () => {
      throw new Error('Der Bau fragt nicht');
    },
  };
  return _req('startup/wiring.js').buildServices(stummel, { contexts });
}

/** Die Klienten der Fremdquellen sind kein Dienst, sondern deren Inhalt; sie zählen als einer. */
const GANZ = new Set(['quellen', 'drossel']);

/** Jeder Dienst als `bereich.name` oder `bereich.teil.name`. */
function leaves(x, vor) {
  return Object.entries(/** @type {Record<string, unknown>} */ (x)).flatMap(([n, v]) => {
    if (n === 'ueber') return [];
    const teil = v && typeof v === 'object' && !GANZ.has(n) && Object.values(v).some(w => typeof w === 'function');
    return teil ? leaves(v, `${vor}.${n}`) : [`${vor}.${n}`];
  });
}

/** Je Bereich höchstens so viele; ein neuer Dienst verdrängt einen alten. */
const JE_AREA = {
  throttle: 10,
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
  inventory: 43, // mit den Schreibwegen, die sets, parts und figuren abgaben (Tabellenbesitz)
  sets: 41,
  parts: 13,
  minifigs: 8,
  wanted: 9,
  vouchers: 16,
  collection: 8,
  management: 28,
};

/** Quelltext ausserhalb der Tests, ohne Kommentare, je Datei (Pfad ab ROOT). */
function quellen() {
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

  // testArea() und jeder Leser nähmen sonst den Dienst, wo das Repository gemeint ist.
  const gleich = schluessel.filter(s => {
    const [b = '', k = ''] = s.split('.');
    return typeof contexts[b]?.[k] === 'object' && contexts[b][k] !== null;
  });
  assert.deepEqual(gleich, [], 'Dienst heisst wie ein Teil des Kontexts');

  // Gerufen über den Satz (`d.account.…`, `k.konto.…`) oder genannt in Pick<…>; die Fabrik des Bereichs zählt nicht.
  const q = quellen();
  const ohne = schluessel.filter(s => {
    const name = s.split('.').at(-1);
    const muster = new RegExp(`[.?]\\s*${name}\\b|['"]${name}['"]`);
    const b = s.split('.')[0];
    const factory = ['bereich.ts', 'area.ts'].map(f => `src/${b}/${f}`).find(f => q.has(f)) ?? `src/${b}/bereich.ts`;
    return ![...q].some(([datei, text]) => datei !== factory && muster.test(text));
  });
  assert.deepEqual(ohne, [], 'Schlüssel ohne Aufrufer ausserhalb der Tests');
});

/** Dienste, die ein Repository roh weiterreichen, mit Grund; die Liste wird kürzer, nie länger. */
const RAW_ALLOWED = {
  'jobQueue.belegeAuftrag': 'Pacht des Workers (jobs/jobWorker.ts): die Regel steht im SQL der Warteschlange',
  'jobQueue.giveBack': 'Pacht des Workers (jobs/jobWorker.ts): die Regel steht im SQL der Warteschlange',
  'jobQueue.lebenszeichen': 'Pacht des Workers (jobs/jobWorker.ts): die Regel steht im SQL der Warteschlange',
  'jobQueue.rememberExclusive': 'Pacht des Workers (jobs/jobWorker.ts): die Regel steht im SQL der Warteschlange',
  'jobQueue.letzteJeArt': 'Kacheln der Verwaltung: je Art die letzte Zeile, so wie sie steht',
  'jobQueue.cleanCompletedOn': 'Aufräumlauf: Frist und Regel stehen in der Abfrage',
  'jobQueue.liesPause': 'Pause einer Art (CDN, Brickset): Frist und Grund setzt der Aufrufer',
  'jobQueue.pauseKind': 'Pause einer Art (CDN, Brickset): Frist und Grund setzt der Aufrufer',
  'jobQueue.liesZustand': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'jobQueue.deleteState': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'jobQueue.setzeZustand': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'jobQueue.countState': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'throttle.hourlyState': 'Guthabenschranke: prüft und zählt in der Transaktion von src/vouchers',
  'throttle.countHour': 'Guthabenschranke: prüft und zählt in der Transaktion von src/vouchers',
  'sets.setsOfAccount': 'Setnummern eines Kontos für das Löschen der Sammlung (src/collection), ohne Regel davor',
  'finances.marketPriceFromCache':
    'Rückfall der Set-Bewertung (src/sets/service.ts) auf den Zwischenspeicher, ohne Regel',
  'finances.marketPriceFromHistory': 'Rückfall der Set-Bewertung (src/sets/service.ts) auf den Verlauf, ohne Regel',
  'vouchers.reencryptAllVouchers':
    'Altbestand beim Start: Das Umschlüsseln steht im Repository, eine Regel davor gibt es nicht',
  'vouchers.reencryptCopies':
    'Altbestand beim Start: Das Umschlüsseln steht im Repository, eine Regel davor gibt es nicht',
  'vouchers.reencryptNumbers':
    'Altbestand beim Start: Das Umschlüsseln steht im Repository, eine Regel davor gibt es nicht',
  'catalog.catalogStatus':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
  'catalog.rememberCatalogPlaceholder':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
  'catalog.rememberSetCatalog':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
};

/** Je Bereich die Funktionen seiner Repositories, wie der Bau sie lädt. */
function repositoryFunctions(b, q) {
  const raus = new Set();
  for (const rel of q.keys())
    if (rel.startsWith(`src/${b}/repository/`) || rel === `src/${b}/repository.ts`)
      for (const f of Object.values(_req(rel.replace(/\.ts$/, '.js')))) if (typeof f === 'function') raus.add(f);
  return raus;
}

/** `name: mit(k.db, modul.f)` in der Fabrik, mit f aus einem Repository des Bereichs. */
function boundRepositories(b, leavesOfArea, q) {
  const factory = q.get(`src/${b}/bereich.ts`) ?? q.get(`src/${b}/area.ts`);
  if (!factory) return [];
  const repo = repositoryFunctions(b, q);
  const raus = [];
  for (const m of factory.matchAll(/^\s*(\w+): mit\(\w+\.db,\s*(\w+)\.(\w+)\)/gm)) {
    const imp = new RegExp(`import \\* as ${m[2]} from '\\./([^']+)'`).exec(factory);
    const f = imp && _req(`src/${b}/${imp[1]}.js`)[m[3]];
    if (f && repo.has(f)) raus.push(...leavesOfArea.filter(s => s.endsWith(`.${m[1]}`)));
  }
  return raus;
}

test('kein Dienstschlüssel reicht ein Repository roh weiter', () => {
  /** @type {Record<string, any>} */
  const contexts = {};
  const d = satz(contexts);
  const q = quellen();
  const roh = new Set();
  for (const [b, x] of Object.entries(d)) {
    const leavesOfArea = leaves(x, b);
    // Derselbe Funktionswert wie im Kontext (k.repo.f, ...k.repo): Der Dienst ist das Repository.
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
  assert.ok(roh.has('jobQueue.liesZustand') && roh.has('catalog.catalogStatus'), 'Selbstbeweis: beide Formen gefunden');
  assert.deepEqual(
    [...roh].sort(),
    Object.keys(RAW_ALLOWED).sort(),
    'Dienstschlüssel, die ein Repository roh weiterreichen',
  );
  const LIMIT_RAW = 23;
  assert.ok(roh.size <= LIMIT_RAW, `${roh.size} rohe Weitergaben, erlaubt ${LIMIT_RAW}`);
});
