/**
 * Tabellen ohne user_id teilen sich alle Konten. Welche das sind, steht unten
 * in GEMEINSAM, je Tabelle mit Art und ob Eingaben eines Kontos hinein dürfen.
 * Die Tabellen kommen aus dem echten Schema, die schreibenden Stellen aus dem
 * Quelltext (eine neue Stelle auf eine Katalogtabelle muss hier eingetragen …
 *
 * Gegenproben (am 04.11.2026 gemessen, je eine Änderung, danach zurück):
 *   A  routes/api_v1/wanted.ts: merkeNummer schreibt immer merkeBlNummer →
 *      rot: „Eingaben eines Kontos landen in keiner gemeinsamen Tabelle“
 *      (bl_mapping trägt die Marke)
 *   B  merkeFigur() in src/katalog/katalogPflege.ts ohne den Zweig für `von` →
 *      rot: dieselbe Prüfung (minifigs_catalog)
 *   C  ein `INSERT INTO part_catalog` in src/parts/repository/manualParts.ts
 *      → rot: „jede schreibende Stelle auf eine Katalogtabelle ist eingetragen“
 *   D  eine Tabelle `probe_gemeinsam (x int)` per Migration → rot: „jede
 *      Tabelle ohne user_id steht in der Liste“
 *
 * Jede Tabelle hat einen Besitzer-Bereich (BESITZER); nur er schreibt hinein,
 * andere rufen seinen Dienst. Gegenproben (10.11.2026 gemessen):
 *   E  `DELETE FROM price_cache` zurück nach src/management/repository/management.ts
 *      → rot: „jede Tabelle hat einen Besitzer, nur er schreibt hinein“ (und
 *      „jede schreibende Stelle auf eine Katalogtabelle …“)
 *   F  merkeKatalogCache zurück nach src/sets/repository/setDetail.ts → rot: dieselbe
 *      Prüfung (und „jede schreibende Stelle auf eine Katalogtabelle …“)
 *   G  die Zeile 'db/schemaStart.ts → global_settings' aus FREMDSCHREIBER gestrichen
 *      → rot: dieselbe Prüfung
 *
 * Die Besitzer stehen in docs/architektur.md („Tabellen und Besitzer“), je Tabelle genau einer.
 * Fremde Bereiche lesen über Lesebausteine in db/ oder den Dienst des Besitzers; die direkten
 * Lesestellen zählt eine Ratsche, aufwärts gilt null. Gegenproben (H 15.11., I/J 14.11.2026 gemessen):
 *   H  `SELECT 1 FROM price_cache` in src/sets/repository/sets.ts → rot: „fremde Bereiche lesen
 *      nie aufwärts …“ (27 abwärts von 26)
 *   I  `DELETE FROM user_settings` in src/konto/repository/konten.ts → rot: „jede Tabelle hat
 *      einen Besitzer, nur er schreibt hinein“
 *   J  die Zeile von src/drossel in docs/architektur.md gestrichen → rot: dieselbe Prüfung
 *      (rate_limit_attempts ohne Besitzer)
 *   K  setWert.ts liest wieder `FROM set_acquisitions` statt setErfassungen() → rot: dieselbe
 *      Prüfung, aufwärts ['src/finanzen → set_acquisitions'] (15.11.2026)
 *   L  'src/sets → parts_version_user' aus TRIGGER_FREMDZIELE gestrichen → rot: „Trigger schreiben
 *      nur in Tabellen ihres Besitzers …“ (15.11.2026)
 *
 * Ein Lesebaustein in db/ zählt beim Bereich, der ihn importiert; was er liest, zeigt sein Ergebnis.
 * Liegt der Bereich unter dem Besitzer, bekommt er den Baustein über seinen Lesevertrag (src/dienste.ts
 * reicht ihn). Gegenproben (15.11.2026 gemessen, je einzeln):
 *   M  src/bilder/repository/bildBlickfeld.ts importiert gezaehlteSets wieder aus db/bestandSicht →
 *      rot: „… aufwärts über db/“ ['src/bilder → price_alerts', 'src/bilder → sets', 'src/bilder → wanted']
 *   N  src/katalog/repository/katalogSuche.ts importiert mengeJoin wieder aus db/bestandsmenge → rot:
 *      dieselbe Prüfung, ['src/katalog → set_acquisitions']
 *   O  setBestand in db/bestandSicht.ts liest `FROM parts` → rot am Selbstbeweis „setBestand liest
 *      sets“; setzt es den Namen zur Laufzeit zusammen, bleibt es grün: gezählt wird das Ergebnis.
 *
 * Wählt eine Datei den Tabellennamen zur Laufzeit, zählt, was sie beim Aufruf über einen mitschreibenden
 * Zugang liest und schreibt (DYNAMISCH, messeDatei). Gegenproben (15.11.2026 gemessen, je einzeln):
 *   P  src/bestand/repository/lagerort.ts: TABELLEN.set = 'instructions' → rot: „gemessen, wie
 *      eingetragen“, „nur er schreibt hinein“ ['…/lagerort.ts → instructions'] und „lesen nie
 *      aufwärts“ ['src/bestand → instructions']; die Regex auf wörtliche Namen sah beides nicht
 *   Q  cacheZahlen() in src/katalog/repository/katalogCache.ts zählt wieder zaehle('price_cache') →
 *      rot: „gemessen, wie eingetragen“ und „lesen nie aufwärts“ ['src/katalog → price_cache']
 *   R  src/wanted/repository/wanted.ts liest wieder `FROM sets s` statt setBestand() → rot:
 *      „25 direkte Lesestellen (abwärts), erlaubt sind 24“
 *
 * Die Eingaben macht jedes Konto in seinem Namen (alsKonto) als Laufzeitrolle, wie im
 * Betrieb; Testdaten und die Suche danach laufen über die Eigentümerin.
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, ohneKommentare, testDaten, alsKonto, testQuellen } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { importWorker } = require('./helpers/auftraege');
const db = testDaten();
const { testServer } = require('./helpers/server');

// Ohne Netz: Rebrickable kennt nichts (testQuellen), dann bleibt nur die Eingabe selbst.
testQuellen(null, {
  lookupPart: async () => null,
  getMinifigInfo: async () => null,
  setAngaben: async () => null,
});

const KATALOG = 'katalog'; // geprüfte Quellen (Rebrickable, BrickLink, Brickset, EZB)
const BETRIEB = 'betrieb'; // Zustand des Servers, keine Angaben über Teile
const KONTO = 'account_id'; // gehört einem Konto über einen anderen Schlüssel

/** type, eingabe (false oder warum Eingaben hinein dürfen), schreiber (nur Katalog). */
const GEMEINSAM = {
  bl_mapping: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/blZuordnung.ts'] },
  catalog_cache: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/katalog/repository/katalogCache.ts', 'src/katalog/repository/rebrickableCache.ts'],
  },
  set_catalog: {
    type: KATALOG,
    eingabe: false,
    schreiber: [
      'src/katalog/repository/bildlage.ts',
      'src/katalog/repository/csvTausch.ts',
      'src/katalog/repository/setStamm.ts',
      'src/katalog/repository/teileAnreicherung.ts',
    ],
  },
  part_catalog: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  part_color_catalog: {
    type: KATALOG,
    eingabe: false,
    schreiber: [
      'src/katalog/repository/csvKatalog.ts',
      'src/katalog/repository/katalogStamm.ts',
      'src/katalog/repository/teileAnreicherung.ts',
    ],
  },
  minifigs_catalog: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/katalog/repository/katalogStamm.ts', 'src/katalog/repository/teileAnreicherung.ts'],
  },
  set_parts: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  set_minifigs: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/katalogStamm.ts'] },
  subsets_cache: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/katalog/repository/katalogCache.ts', 'src/katalog/repository/rebrickableCache.ts'],
  },
  minifig_parts_cache: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/rebrickableCache.ts'] },
  shared_instructions: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/anleitungen.ts'] },
  rb_colors: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/katalog/repository/blZuordnung.ts', 'src/katalog/repository/csvTausch.ts'],
  },
  rb_inventories: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/csvTausch.ts'] },
  rb_inventory_minifigs: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/csvTausch.ts'] },
  rb_inventory_parts: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/csvTausch.ts'] },
  rb_part_categories: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/csvTausch.ts'] },
  rb_parts: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/csvTausch.ts'] },
  rb_sets: {
    type: KATALOG,
    eingabe: false,
    schreiber: [
      'src/katalog/repository/bildlage.ts',
      'src/katalog/repository/csvTausch.ts',
      'src/katalog/repository/setStamm.ts',
    ],
  },
  rb_themes: { type: KATALOG, eingabe: false, schreiber: ['src/katalog/repository/csvTausch.ts'] },
  price_cache: { type: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts'] },
  price_history: {
    type: KATALOG,
    eingabe: false,
    schreiber: [
      'src/finanzen/repository/preisCache.ts',
      'src/finanzen/repository/preisLauf.ts',
      'src/finanzen/repository/preisverlauf.ts',
    ],
  },
  part_price_cache: { type: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts'] },
  part_price_history: { type: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/preisCache.ts'] },
  minifig_price_cache: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/finanzen/repository/marktpreise.ts', 'src/finanzen/repository/preisCache.ts'],
  },
  minifig_price_history: {
    type: KATALOG,
    eingabe: false,
    schreiber: ['src/finanzen/repository/marktpreise.ts', 'src/finanzen/repository/preisCache.ts'],
  },
  exchange_rates: { type: KATALOG, eingabe: false, schreiber: ['src/finanzen/repository/wechselkurse.ts'] },
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

/** Dateien, die einen Tabellennamen zur Laufzeit wählen (nicht über den Lesevertrag `l.`): was sie
 * lesen und schreiben, gemessen (messeDatei). Steht es hier, ist die Messung vollständig; Besitzer
 * und Stufen gelten für das Gemessene wie für wörtliche Namen. */
const DYNAMISCH = {
  'src/bestand/repository/erfassungen.ts': {
    liest: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    schreibt: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/bestand/repository/gemeinsam.ts': {
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
  'src/bestand/repository/kaeufe.ts': {
    liest: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    schreibt: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/bestand/repository/kaufErfassungen.ts': {
    liest: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
    schreibt: ['minifig_acquisitions', 'part_acquisitions', 'set_acquisitions'],
  },
  'src/bestand/repository/lagerort.ts': {
    liest: ['minifigs', 'parts', 'sets', 'storage_locations', 'users'],
    schreibt: ['minifigs', 'parts', 'sets', 'storage_locations'],
  },
  'src/bestand/repository/manuelleMengen.ts': {
    liest: ['minifig_acquisitions', 'part_acquisitions'],
    schreibt: ['minifig_acquisitions', 'part_acquisitions'],
  },
  'src/bestand/repository/papierkorb.ts': {
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
  'src/bestand/repository/umhaengen.ts': {
    liest: ['minifig_acquisitions', 'minifigs', 'part_acquisitions', 'parts'],
    schreibt: ['minifig_acquisitions', 'minifigs', 'part_acquisitions', 'parts'],
  },
  'src/finanzen/repository/preisverlauf.ts': {
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
  'src/katalog/repository/csvTausch.ts': {
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
  'src/katalog/repository/katalogCache.ts': {
    liest: ['catalog_cache', 'rb_sets', 'set_catalog', 'subsets_cache'],
    schreibt: ['catalog_cache', 'subsets_cache'],
  },
  'src/katalog/repository/teileAnreicherung.ts': {
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

const SCHREIBE =
  /\b(?:INSERT INTO|DELETE FROM|TRUNCATE(?: TABLE)?)\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)|(?<!DO )\bUPDATE\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)[^;`'"]*?\bSET\b/g;
const LIES = /\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\b/g;
const NAME_ZUR_LAUFZEIT =
  /\b(?:FROM|JOIN|USING|INSERT INTO|DELETE FROM|UPDATE|TRUNCATE(?: TABLE)?)\s+(?:ONLY\s+)?\$\{\s*([\w$]+)(\s*[.[(])?/g;

/** Dateien unter src/, deren SQL einen Tabellennamen aus einer eigenen Variablen nimmt. Ausgenommen:
 * der Lesevertrag (`l.…`) und Lesebausteine aus db/, deren Ergebnis die Prüfung über db/ misst. */
function dateienMitNamenZurLaufzeit() {
  const aus = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) lauf(p);
      else if (n.endsWith('.ts')) {
        const s = ohneKommentare(fs.readFileSync(p, 'utf8'));
        const ausDb = new Set(
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
          m => !(m[1] === 'l' && /[.[]/.test(m[2] ?? '')) && !(ausDb.has(m[1]) && (m[2] ?? '').trim() === '('),
        );
        if (eigen) aus.push(path.relative(ROOT, p).split(path.sep).join('/'));
      }
    }
  })(path.join(ROOT, 'src'));
  return aus.sort();
}

/** Ein Wert, der für jede Probe passt: Zahl, Text, Liste, Objekt, Lesevertrag. */
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

/** Ruft jeden Export der Datei je Art über einen Zugang, der die Abfragen nur mitschreibt. Wählt der
 * Aufrufer den Namen, dann aus einer exportierten Liste der Datei: Ihre Werte sind weitere Proben.
 * @returns gelesene und geschriebene Tabellen, soweit das Schema sie kennt */
async function messeDatei(datei, bekannt) {
  const liest = new Set(),
    schreibt = new Set();
  const c = chamaeleon();
  const merke = sql => {
    for (const m of String(sql).matchAll(LIES)) if (bekannt.has(m[1])) liest.add(m[1]);
    for (const m of String(sql).matchAll(SCHREIBE)) if (bekannt.has(m[1] ?? m[2])) schreibt.add(m[1] ?? m[2]);
  };
  const antwort = value => async sql => {
    merke(sql);
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
            // Eine Probe, die nicht passt, fragt nichts.
          }
  return { liest: [...liest].sort(), schreibt: [...schreibt].sort() };
}

/** Je Bereich die Tabellen, in die nur er schreibt: die Tabelle in docs/architektur.md. */
function besitzerAusDoku() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architektur.md'), 'utf8');
  const abschnitt = doc.slice(doc.indexOf('## Tabellen und Besitzer'), doc.indexOf('## API-Vertrag'));
  return Object.fromEntries(
    [...abschnitt.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map(m => [
      m[1],
      [...m[2].matchAll(/`([^`]+)`/g)].map(x => x[1]),
    ]),
  );
}
const BESITZER = besitzerAusDoku();

/** Ausnahmen von „nur der Besitzer schreibt“; eine Ratsche: nur streichen, nie ergänzen. */
const FREMDSCHREIBER = [
  // Der Schemastart schreibt die Zeitzone, bevor es Dienste gibt.
  'db/schemaStart.ts → global_settings',
];

/** Trigger, die in die Tabelle eines anderen Bereichs schreiben: „Besitzer der Triggertabelle →
 * Ziel“ und warum das nicht über den Dienst des Ziels geht. Eine Ratsche wie FREMDSCHREIBER. */
const TRIGGER_FREMDZIELE = {
  'src/bestand → parts_version_user':
    'Der Teilezähler muss jede Änderung an Sets, Käufen, Teilen und Lagerorten sehen, auch ohne src/parts',
  'src/katalog → parts_catalog_pending':
    'Katalogänderungen merken nur die Nummer vor; src/parts zieht die Zusammenfassung nach und leert die Liste',
};

/** Lesen fremde Bereiche eine Tabelle direkt (FROM, JOIN, USING), statt über einen Lesebaustein
 * in db/ oder den Dienst des Besitzers? Paare „Bereich → Tabelle“; db/ selbst ist der Lesebaustein.
 * Aufwärts (Besitzer auf höherer Stufe) ist verboten; Katalogtabellen sind gemeinsame Stammdaten
 * und werden getrennt gezählt; der Rest liest abwärts und darf nur weniger werden. */
const KATALOG_LESER_HOECHSTENS = 49;
const ABWAERTS_LESER_HOECHSTENS = 24;

/** Je Bereich seine Stufe aus docs/architektur.md („Rangfolge der Bereiche“). */
function stufenAusDoku() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architektur.md'), 'utf8');
  const abschnitt = doc.slice(doc.indexOf('## Rangfolge der Bereiche'), doc.indexOf('## Schema'));
  return new Map(
    [...abschnitt.matchAll(/^\| (\d+) \| (.+) \|$/gm)].flatMap(m =>
      [...m[2].matchAll(/`([^`]+)`/g)].map(x => [x[1], Number(m[1])]),
    ),
  );
}

/** „aufwärts“, „katalog“ oder „abwärts“ für den Leser `b` einer Tabelle des Besitzers `eigner`. */
function leseRichtung(stufen, b, eigner) {
  if (eigner === 'src/katalog') return 'katalog';
  return stufen.get(eigner) > stufen.get(b) ? 'aufwärts' : 'abwärts';
}

function fremdeLeser(besitzer) {
  const paare = new Set();
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) lauf(p);
      else if (n.endsWith('.ts')) {
        const datei = path.relative(ROOT, p).split(path.sep).join('/');
        const b = bereichVon(datei);
        const s = ohneKommentare(fs.readFileSync(p, 'utf8'));
        for (const m of s.matchAll(/\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/g))
          if (besitzer.has(m[1]) && besitzer.get(m[1]) !== b) paare.add(`${b} → ${m[1]}`);
      }
    }
  })(path.join(ROOT, 'src'));
  return [...paare].sort();
}

const bereichVon = datei => (datei.startsWith('src/') ? datei.split('/').slice(0, 2).join('/') : datei.split('/')[0]);

const LESE = /\b(?:FROM|JOIN|USING)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\b/g;

/** Je Lesebaustein in db/ und Export die Tabellen, die sein Ergebnis liest: Jede Funktion läuft mit
 * Proben je Art und einem Zugang, der die Abfragen nur mitschreibt. So zählt auch, was über eine
 * Konstante (ZAEHLT) oder eine asynchrone Abfrage gelesen wird. */
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
      const merke = sql => {
        for (const m of String(sql).matchAll(LESE)) tabellen.add(m[1]);
      };
      const zugang = {
        get: async sql => {
          merke(sql);
          return null;
        },
        all: async sql => {
          merke(sql);
          return [];
        },
        run: async sql => merke(sql),
        toString: () => '$9',
      };
      if (typeof value === 'string') merke(value);
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
              else merke(r);
            } catch {
              // Eine Probe, die nicht passt, liest nichts.
            }
          }
        }
      if (tabellen.size) je[modul][name] = [...tabellen].sort();
    }
  }
  return je;
}

/** Paare „Bereich → Tabelle“, die ein Bereich über importierte Lesebausteine liest (auch `* as`). */
function leserUeberDb(bausteine) {
  const paare = new Set();
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
    const b = datei === 'src/dienste.ts' ? datei : bereichVon(datei);
    const s = fs.readFileSync(p, 'utf8');
    for (const m of s.matchAll(/^import\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'(?:\.\.?\/)+db\/(\w+)'/gm)) {
      const baustein = bausteine[m[2]];
      if (!baustein) continue;
      const namen = m[1].startsWith('*')
        ? Object.keys(baustein)
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
      for (const name of namen) for (const t of baustein[name] ?? []) paare.add(`${b} → ${t}`);
    }
  }
  return [...paare].sort();
}

const MARKE = 'zzmarke7q';

/** Datei → geschriebene Tabellen, ohne Kommentare; `DO UPDATE SET` ist kein Tabellenname. */
function schreibendeStellen() {
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

test('gemeinsame Tabellen', { concurrency: 1, timeout: 120_000 }, async t => {
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

  await t.test('jede Tabelle ohne user_id steht in der Liste', async () => {
    const ohne = (
      await db.all(`
      SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind IN ('r', 'p') AND NOT EXISTS (
         SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'user_id' AND NOT a.attisdropped)`)
    ).map(z => z.t);
    assert.ok(ohne.length > 30, `nur ${ohne.length} Tabellen gefunden — greift die Abfrage noch?`);
    assert.deepEqual(ohne.sort(), Object.keys(GEMEINSAM).sort());
  });

  // Gemessen einmal, für die Prüfungen auf Schreiber, Besitzer und Stufen unten.
  const gemessen = {};
  await t.test('Tabellennamen zur Laufzeit: gemessen, wie eingetragen', async () => {
    const bekannt = new Set(Object.values(BESITZER).flat());
    const dateien = dateienMitNamenZurLaufzeit();
    assert.ok(dateien.length > 5, `nur ${dateien.length} Dateien — greift die Suche noch?`);
    for (const d of dateien) gemessen[d] = await messeDatei(d, bekannt);
    assert.deepEqual(gemessen, DYNAMISCH, 'Neue Datei oder neue Tabelle zur Laufzeit: in DYNAMISCH eintragen');
  });

  await t.test('jede schreibende Stelle auf eine Katalogtabelle ist eingetragen', () => {
    const { tabellen, dynamisch } = schreibendeStellen();
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
    for (const [name, e] of Object.entries(GEMEINSAM)) {
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

  await t.test('jede Tabelle hat einen Besitzer, nur er schreibt hinein', async () => {
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
    // Tabellen ausserhalb des Schemas (Kopien vor Migrationen, temporäre) haben keinen Besitzer.
    for (const [tabelle, dateien] of schreibendeStellen().tabellen)
      for (const d of dateien)
        if (besitzer.has(tabelle) && bereichVon(d) !== besitzer.get(tabelle)) fremd.push(`${d} → ${tabelle}`);
    assert.ok(Object.keys(gemessen).length > 5, 'Selbstbeweis: die Messung der Namen zur Laufzeit lief');
    for (const [d, { schreibt }] of Object.entries(gemessen))
      for (const tabelle of schreibt)
        if (bereichVon(d) !== besitzer.get(tabelle) && !fremd.includes(`${d} → ${tabelle}`))
          fremd.push(`${d} → ${tabelle}`);
    assert.deepEqual(
      fremd.sort(),
      [...FREMDSCHREIBER].sort(),
      'Schreib-SQL gehört in den Besitzer-Bereich der Tabelle; andere Bereiche rufen dessen Dienst.',
    );
  });

  await t.test('Trigger schreiben nur in Tabellen ihres Besitzers oder in begründete Ziele', async () => {
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

  await t.test('fremde Bereiche lesen nie aufwärts, sonst weniger Tabellen direkt', async () => {
    const besitzer = new Map(Object.entries(BESITZER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    assert.ok(besitzer.size > 60, `nur ${besitzer.size} Tabellen in docs/architektur.md — greift die Suche noch?`);
    const stufen = stufenAusDoku();
    assert.ok(stufen.size > 20, `nur ${stufen.size} Stufen in docs/architektur.md — greift die Suche noch?`);
    const je = { aufwärts: [], katalog: [], abwärts: [] };
    const paare = new Set(fremdeLeser(besitzer));
    assert.ok(Object.keys(gemessen).length > 5, 'Selbstbeweis: die Messung der Namen zur Laufzeit lief');
    // Was die Messung über einen importierten Lesebaustein sieht, zählt die Prüfung über db/ unten.
    const ueberDb = new Set(leserUeberDb(await lesebausteine(_req)));
    for (const [d, { liest }] of Object.entries(gemessen))
      for (const tabelle of liest) {
        const paar = `${bereichVon(d)} → ${tabelle}`;
        if (besitzer.get(tabelle) !== bereichVon(d) && !ueberDb.has(paar)) paare.add(paar);
      }
    for (const paar of [...paare].sort()) {
      const [b, tabelle] = paar.split(' → ');
      assert.ok(stufen.has(b), `${b} hat keine Stufe`);
      je[leseRichtung(stufen, b, besitzer.get(tabelle))].push(paar);
    }
    // Selbstbeweis der Einteilung, an echten Stufen.
    assert.equal(leseRichtung(stufen, 'src/finanzen', besitzer.get('sets')), 'aufwärts');
    assert.ok(je.abwärts.includes('src/management → sets'), 'Selbstbeweis: die Verwaltung liest sets direkt');
    assert.ok(je.katalog.length > 10, 'Selbstbeweis: Katalogtabellen werden gelesen');
    assert.deepEqual(
      je.aufwärts,
      [],
      'Ein tieferer Bereich liest die Tabelle eines höheren: Form im eigenen Lesevertrag nennen, SQL über src/dienste.ts reichen.',
    );
    for (const [type, schranke] of [
      ['katalog', KATALOG_LESER_HOECHSTENS],
      ['abwärts', ABWAERTS_LESER_HOECHSTENS],
    ]) {
      assert.ok(
        je[type].length <= schranke,
        `${je[type].length} direkte Lesestellen (${type}), erlaubt sind ${schranke}.\n${je[type].join('\n')}`,
      );
      if (je[type].length < schranke)
        console.log(`  ℹ fremde Leser (${type}): ${je[type].length} (Schranke ${schranke}) — Schranke nachziehen`);
    }
  });

  await t.test('auch über db/ liest kein Bereich die Tabelle eines höheren', async () => {
    const besitzer = new Map(Object.entries(BESITZER).flatMap(([b, ts]) => ts.map(x => [x, b])));
    const stufen = stufenAusDoku();
    const bausteine = await lesebausteine(_req);
    // Selbstbeweis: Was die Bausteine lesen, kommt aus ihrem Ergebnis, auch über Konstanten.
    assert.deepEqual(bausteine.bestandSicht?.setBestand, ['sets'], 'setBestand liest sets');
    assert.deepEqual(bausteine.zugangSicht?.familieLebt, ['api_tokens']);
    assert.ok(bausteine.bestandSicht?.setZaehlt?.includes('price_alerts'), 'setZaehlt liest über ZAEHLT');
    assert.ok(bausteine.bestandsmenge?.mengeDesSets?.includes('sets'), 'asynchrone Bausteine zählen');
    const leser = leserUeberDb(bausteine);
    assert.ok(leser.includes('src/sets → set_acquisitions'), 'Selbstbeweis: sets liest eigene Käufe über db/');
    assert.ok(leser.includes('src/dienste.ts → price_alerts'), 'Selbstbeweis: `* as` zählt alle Exporte');
    const aufwaerts = leser.filter(paar => {
      const [b, tabelle] = paar.split(' → ');
      assert.ok(stufen.has(b), `${b} hat keine Stufe`);
      return besitzer.has(tabelle) && stufen.get(besitzer.get(tabelle)) > stufen.get(b);
    });
    assert.deepEqual(
      aufwaerts,
      [],
      'Ein Bereich liest über db/ aufwärts: die Form in seinen Lesevertrag (src/<bereich>/lesevertrag.ts), den Baustein über src/dienste.ts reichen.',
    );
  });

  await t.test('Eingaben eines Kontos landen in keiner gemeinsamen Tabelle', async () => {
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
    await alsKonto(A, async () => {
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
    await alsKonto(B, async () => {
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
    for (const [name, e] of Object.entries(GEMEINSAM)) {
      if (e.eingabe !== false) continue;
      const n = (await db.get(`SELECT count(*)::int AS n FROM ${name} x WHERE x::text LIKE $1`, [`%${MARKE}%`])).n;
      if (n) befallen.push(`${name} (${n})`);
    }
    assert.deepEqual(befallen, []);
    // Gegenstück: Die Eingaben stehen bei den Konten, sonst prüfte die Suche oben nichts.
    const eigen = await db.get(`SELECT
      (SELECT count(*) FROM bl_mapping_custom e WHERE e::text LIKE '%${MARKE}%')::int AS bl,
      (SELECT count(*) FROM minifig_custom e WHERE e::text LIKE '%${MARKE}%')::int AS fig,
      (SELECT count(*) FROM part_custom e WHERE e::text LIKE '%${MARKE}%')::int AS teil`);
    assert.deepEqual(eigen, { bl: 5, fig: 2, teil: 1 });
  });
});
