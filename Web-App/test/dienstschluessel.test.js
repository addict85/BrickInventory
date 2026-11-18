/**
 * Der Dienstsatz (baueDienste) ist die Fläche, über die Bereiche, Routen und Jobs
 * einander rufen. Seine Schlüssel heissen deutsch, und es werden weniger, nie mehr:
 * Was nur ein Bereich selbst braucht, ruft er über seine Funktionen.
 *
 * Gezählt wird am gebauten Satz, nicht im Quelltext: Ein Schlüssel aus einem Spread
 * oder einer Hilfsfunktion (bildDienste im Katalog) zählt so mit, eine Teilfläche
 * (konto.sitzungen.*) mit jedem ihrer Dienste. Der Zugang ist ein Stummel; der
 * Bau fragt die Datenbank nicht.
 *
 * Gegenproben (15.11.2026):
 *   A  in src/katalog/bereich.ts `setInfo` wieder `setAngaben` → rot „englische
 *      Dienstschlüssel“ (katalog.setAngaben)
 *   B  in src/vouchers/area.ts `batchCreate` wieder in den Satz → rot „Zahl
 *      der Dienstschlüssel“
 *   C  in src/parts/area.ts `readParts` wieder `partsList` (wie das Repository im
 *      Kontext) → rot „Dienst heisst wie ein Teil des Kontexts“ (parts.partsList)
 *   D  `setzeAktiv: mit(k)(kontenDienst.setzeAktiv)` zurück in src/konto/bereich.ts → rot
 *      „Zahl der Dienstschlüssel“ (547, erlaubt 546)
 *   E  in routes/auth/zweiterFaktor.ts `d.faktoren.erneuereCodes` durch einen
 *      Platzhalter ersetzt → rot „ohne Aufrufer“ (faktoren.erneuereCodes)
 *   F  JE_BEREICH.konto auf 88 → rot „Schlüssel je Bereich“ (konto 89, erlaubt 88)
 *
 * Rohe Weitergaben (ein Dienst ist das Repository selbst, k.repo.f oder mit(k.db, repo.f)):
 * Gegenproben (15.11.2026):
 *   G  `gueltigerToken: k.zugaenge.gueltigerToken` zurück in src/konto/bereich.ts → rot „Zahl
 *      der Dienstschlüssel“ (538, erlaubt 537) und „roh weiterreichen“ (konto.gueltigerToken)
 *   H  'katalog.katalogStand' aus ROH_ERLAUBT gestrichen → rot „roh weiterreichen“ (die Form
 *      mit(k.db, setStamm.katalogStand), über den Bau als Repository-Funktion erkannt)
 *   I  JE_BEREICH.faktoren auf 17 → rot „Schlüssel je Bereich“ (faktoren 18, erlaubt 17)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildAndRequire, ROOT, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const { englischerName } = require('./helpers/namen');

/** Ein Satz Dienste über einem Zugang, der nichts beantwortet; `kontexte` nimmt die Kontexte auf. */
function satz(kontexte = undefined) {
  const stummel = {
    inTransaktion: () => false,
    transaction: async () => {
      throw new Error('Der Bau fragt nicht');
    },
  };
  return _req('startup/verdrahtung.js').baueDienste(stummel, { kontexte });
}

/** Die Klienten der Fremdquellen sind kein Dienst, sondern deren Inhalt; sie zählen als einer. */
const GANZ = new Set(['quellen', 'drossel']);

/** Jeder Dienst als `bereich.name` oder `bereich.teil.name`. */
function blaetter(x, vor) {
  return Object.entries(/** @type {Record<string, unknown>} */ (x)).flatMap(([n, v]) => {
    if (n === 'ueber') return [];
    const teil = v && typeof v === 'object' && !GANZ.has(n) && Object.values(v).some(w => typeof w === 'function');
    return teil ? blaetter(v, `${vor}.${n}`) : [`${vor}.${n}`];
  });
}

/** Je Bereich höchstens so viele; ein neuer Dienst verdrängt einen alten. */
const JE_BEREICH = {
  throttle: 10,
  einstellungen: 22,
  mail: 13,
  auftraege: 65,
  haushalt: 20,
  geraete: 6,
  faktoren: 18,
  konto: 65,
  profile: 3,
  idempotency: 8,
  fremdquellen: 12,
  bilder: 29,
  katalog: 64,
  finanzen: 36,
  bestand: 43, // mit den Schreibwegen, die sets, parts und figuren abgaben (Tabellenbesitz)
  sets: 41,
  parts: 13,
  minifigs: 8,
  wanted: 9,
  vouchers: 16,
  collection: 8,
  verwaltung: 28,
};

/** Quelltext ausserhalb der Tests, ohne Kommentare, je Datei (Pfad ab ROOT). */
function quellen() {
  const aus = new Map();
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', '.git', 'coverage', 'test', 'public', 'docs', 'frontend-typen'].includes(n))
          lauf(p);
      } else if (n.endsWith('.ts'))
        aus.set(path.relative(ROOT, p).split(path.sep).join('/'), ohneKommentare(fs.readFileSync(p, 'utf8')));
    }
  })(ROOT);
  return aus;
}

test('Dienstschlüssel sind deutsch, werden weniger, nie mehr, und jeder hat einen Aufrufer', () => {
  /** @type {Record<string, any>} */
  const kontexte = {};
  const d = satz(kontexte);
  const schluessel = Object.entries(d).flatMap(([b, x]) => blaetter(x, b));
  assert.ok(Object.keys(d).length > 15, `nur ${Object.keys(d).length} Bereiche gebaut`);
  assert.ok(schluessel.length > 300, `nur ${schluessel.length} Dienstschlüssel — greift die Zählung noch?`);
  assert.ok(schluessel.includes('konto.sitzungen.beendeAndere'), 'Selbstbeweis: Teilflächen zählen je Dienst');

  // Bereiche, die Phase 2a schon vollständig auf Englisch gezogen hat: Ihre englischen
  // Dienstschlüssel sind dort Absicht, nicht die Sorte Einzelfund, den diese Schranke fängt.
  // Wächst mit jedem fertig umgestellten Bereich, nie zurück (siehe auch ratschen.test.js).
  const ENGLISCH_UMGESTELLT = new Set([
    'idempotency',
    'profile',
    'minifigs',
    'wanted',
    'collection',
    'throttle',
    'parts',
    'vouchers',
  ]);
  const SCHRANKE_ENGLISCH = 0;
  const englisch = schluessel.filter(
    s => !ENGLISCH_UMGESTELLT.has(s.split('.')[0] ?? '') && englischerName(s.split('.').at(-1) ?? ''),
  );
  assert.ok(
    englisch.length <= SCHRANKE_ENGLISCH,
    `englische Dienstschlüssel: ${englisch.length}, erlaubt ${SCHRANKE_ENGLISCH}\n${englisch.join('\n')}`,
  );

  const SCHRANKE_ZAHL = 537;
  assert.ok(
    schluessel.length <= SCHRANKE_ZAHL,
    `Zahl der Dienstschlüssel: ${schluessel.length}, erlaubt ${SCHRANKE_ZAHL}`,
  );
  if (schluessel.length < SCHRANKE_ZAHL)
    console.log(`  ℹ Dienstschlüssel: ${schluessel.length} (Schranke ${SCHRANKE_ZAHL}) — nachziehen`);
  const je = {};
  for (const s of schluessel) je[s.split('.')[0]] = (je[s.split('.')[0]] ?? 0) + 1;
  const zuViel = Object.entries(je)
    .filter(([b, n]) => !(b in JE_BEREICH) || n > JE_BEREICH[b])
    .map(([b, n]) => `${b} ${n}, erlaubt ${JE_BEREICH[b] ?? 'keine Schranke'}`);
  assert.deepEqual(zuViel, [], 'Schlüssel je Bereich');

  // testBereich() und jeder Leser nähmen sonst den Dienst, wo das Repository gemeint ist.
  const gleich = schluessel.filter(s => {
    const [b = '', k = ''] = s.split('.');
    return typeof kontexte[b]?.[k] === 'object' && kontexte[b][k] !== null;
  });
  assert.deepEqual(gleich, [], 'Dienst heisst wie ein Teil des Kontexts');

  // Gerufen über den Satz (`d.konto.…`, `k.konto.…`) oder genannt in Pick<…>; die Fabrik des Bereichs zählt nicht.
  const q = quellen();
  const ohne = schluessel.filter(s => {
    const name = s.split('.').at(-1);
    const muster = new RegExp(`[.?]\\s*${name}\\b|['"]${name}['"]`);
    const b = s.split('.')[0];
    const fabrik = ['bereich.ts', 'area.ts'].map(f => `src/${b}/${f}`).find(f => q.has(f)) ?? `src/${b}/bereich.ts`;
    return ![...q].some(([datei, text]) => datei !== fabrik && muster.test(text));
  });
  assert.deepEqual(ohne, [], 'Schlüssel ohne Aufrufer ausserhalb der Tests');
});

/** Dienste, die ein Repository roh weiterreichen, mit Grund; die Liste wird kürzer, nie länger. */
const ROH_ERLAUBT = {
  'auftraege.belegeAuftrag': 'Pacht des Workers (jobs/auftragsWorker.ts): die Regel steht im SQL der Warteschlange',
  'auftraege.gibZurueck': 'Pacht des Workers (jobs/auftragsWorker.ts): die Regel steht im SQL der Warteschlange',
  'auftraege.lebenszeichen': 'Pacht des Workers (jobs/auftragsWorker.ts): die Regel steht im SQL der Warteschlange',
  'auftraege.merkeExklusive': 'Pacht des Workers (jobs/auftragsWorker.ts): die Regel steht im SQL der Warteschlange',
  'auftraege.letzteJeArt': 'Kacheln der Verwaltung: je Art die letzte Zeile, so wie sie steht',
  'auftraege.raeumeErledigteAuf': 'Aufräumlauf: Frist und Regel stehen in der Abfrage',
  'auftraege.liesPause': 'Pause einer Art (CDN, Brickset): Frist und Grund setzt der Aufrufer',
  'auftraege.pausiereArt': 'Pause einer Art (CDN, Brickset): Frist und Grund setzt der Aufrufer',
  'auftraege.liesZustand': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'auftraege.loescheZustand': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'auftraege.setzeZustand': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'auftraege.zaehleZustand': 'Marke über Prozessgrenzen: Schlüssel und Wert ohne eigene Regel',
  'throttle.hourlyState': 'Guthabenschranke: prüft und zählt in der Transaktion von src/vouchers',
  'throttle.countHour': 'Guthabenschranke: prüft und zählt in der Transaktion von src/vouchers',
  'sets.setsDesKontos': 'Setnummern eines Kontos für das Löschen der Sammlung (src/collection), ohne Regel davor',
  'finanzen.marktpreisAusCache': 'Rückfall der Set-Bewertung (src/sets/dienst.ts) auf den Zwischenspeicher, ohne Regel',
  'finanzen.marktpreisAusVerlauf': 'Rückfall der Set-Bewertung (src/sets/dienst.ts) auf den Verlauf, ohne Regel',
  'vouchers.reencryptAllVouchers':
    'Altbestand beim Start: Das Umschlüsseln steht im Repository, eine Regel davor gibt es nicht',
  'vouchers.reencryptCopies':
    'Altbestand beim Start: Das Umschlüsseln steht im Repository, eine Regel davor gibt es nicht',
  'vouchers.reencryptNumbers':
    'Altbestand beim Start: Das Umschlüsseln steht im Repository, eine Regel davor gibt es nicht',
  'katalog.katalogStand':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
  'katalog.merkeKatalogPlatzhalter':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
  'katalog.merkeSetKatalog':
    'Set-Stammdaten in der Transaktion der Set-Erfassung: Der Katalog schreibt sie, sets ruft im eigenen t',
};

/** Je Bereich die Funktionen seiner Repositories, wie der Bau sie lädt. */
function repositoryFunktionen(b, q) {
  const raus = new Set();
  for (const rel of q.keys())
    if (rel.startsWith(`src/${b}/repository/`) || rel === `src/${b}/repository.ts`)
      for (const f of Object.values(_req(rel.replace(/\.ts$/, '.js')))) if (typeof f === 'function') raus.add(f);
  return raus;
}

/** `name: mit(k.db, modul.f)` in der Fabrik, mit f aus einem Repository des Bereichs. */
function gebundeneRepositories(b, blaetterDesBereichs, q) {
  const fabrik = q.get(`src/${b}/bereich.ts`) ?? q.get(`src/${b}/area.ts`);
  if (!fabrik) return [];
  const repo = repositoryFunktionen(b, q);
  const raus = [];
  for (const m of fabrik.matchAll(/^\s*(\w+): mit\(\w+\.db,\s*(\w+)\.(\w+)\)/gm)) {
    const imp = new RegExp(`import \\* as ${m[2]} from '\\./([^']+)'`).exec(fabrik);
    const f = imp && _req(`src/${b}/${imp[1]}.js`)[m[3]];
    if (f && repo.has(f)) raus.push(...blaetterDesBereichs.filter(s => s.endsWith(`.${m[1]}`)));
  }
  return raus;
}

test('kein Dienstschlüssel reicht ein Repository roh weiter', () => {
  /** @type {Record<string, any>} */
  const kontexte = {};
  const d = satz(kontexte);
  const q = quellen();
  const roh = new Set();
  for (const [b, x] of Object.entries(d)) {
    const blaetterDesBereichs = blaetter(x, b);
    // Derselbe Funktionswert wie im Kontext (k.repo.f, ...k.repo): Der Dienst ist das Repository.
    const imKontext = new Set(
      Object.entries(kontexte[b] ?? {})
        .filter(([n, teil]) => n !== 'db' && teil && typeof teil === 'object')
        .flatMap(([, teil]) => Object.values(teil).filter(f => typeof f === 'function')),
    );
    for (const s of blaetterDesBereichs) {
      const f = s
        .split('.')
        .slice(1)
        .reduce((o, n) => o?.[n], x);
      if (typeof f === 'function' && imKontext.has(f)) roh.add(s);
    }
    for (const s of gebundeneRepositories(b, blaetterDesBereichs, q)) roh.add(s);
  }
  assert.ok(roh.has('auftraege.liesZustand') && roh.has('katalog.katalogStand'), 'Selbstbeweis: beide Formen gefunden');
  assert.deepEqual(
    [...roh].sort(),
    Object.keys(ROH_ERLAUBT).sort(),
    'Dienstschlüssel, die ein Repository roh weiterreichen',
  );
  const SCHRANKE_ROH = 23;
  assert.ok(roh.size <= SCHRANKE_ROH, `${roh.size} rohe Weitergaben, erlaubt ${SCHRANKE_ROH}`);
});
