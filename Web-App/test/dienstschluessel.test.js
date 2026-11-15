/**
 * Der Dienstsatz (baueDienste) ist die Fläche, über die Bereiche, Routen und Jobs
 * einander rufen. Seine Schlüssel heissen deutsch, und es werden weniger, nie mehr:
 * Was nur ein Bereich selbst braucht, ruft er über seine Funktionen.
 *
 * Gezählt wird am gebauten Satz, nicht im Quelltext: Ein Schlüssel aus einem Spread
 * oder einer Hilfsfunktion (bildDienste im Katalog) zählt so mit, eine Teilfläche
 * (konto.faktor.*) mit jedem ihrer Dienste. Der Zugang ist ein Stummel; der
 * Bau fragt die Datenbank nicht.
 *
 * Gegenproben (15.11.2026):
 *   A  in src/katalog/bereich.ts `setInfo` wieder `getSetInfo` → rot „englische
 *      Dienstschlüssel“ (katalog.getSetInfo)
 *   B  in src/gutscheine/bereich.ts `stapelAnlegen` wieder in den Satz → rot „Zahl
 *      der Dienstschlüssel“
 *   C  in src/teile/bereich.ts `teileLesen` wieder `teileListe` (wie das Repository im
 *      Kontext) → rot „Dienst heisst wie ein Teil des Kontexts“ (teile.teileListe)
 *   D  `setzeAktiv: mit(k)(kontenDienst.setzeAktiv)` zurück in src/konto/bereich.ts → rot
 *      „Zahl der Dienstschlüssel“ (546, erlaubt 545)
 *   E  in routes/auth/zweiterFaktor.ts `d.konto.faktor.erneuereCodes` durch einen
 *      Platzhalter ersetzt → rot „ohne Aufrufer“ (konto.faktor.erneuereCodes)
 *   F  JE_BEREICH.konto auf 88 → rot „Schlüssel je Bereich“ (konto 89, erlaubt 88)
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
  drossel: 12,
  einstellungen: 22,
  mail: 13,
  auftraege: 65,
  haushalt: 20,
  geraete: 6,
  konto: 89,
  profil: 4,
  idempotenz: 8,
  fremdquellen: 12,
  bilder: 29,
  katalog: 64,
  finanzen: 36,
  bestand: 40,
  sets: 42,
  teile: 13,
  figuren: 9,
  merkliste: 9,
  gutscheine: 16,
  sammlung: 8,
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
  assert.ok(schluessel.includes('konto.faktor.istAktiv'), 'Selbstbeweis: Teilflächen zählen je Dienst');

  const SCHRANKE_ENGLISCH = 0;
  const englisch = schluessel.filter(s => englischerName(s.split('.').at(-1) ?? ''));
  assert.ok(
    englisch.length <= SCHRANKE_ENGLISCH,
    `englische Dienstschlüssel: ${englisch.length}, erlaubt ${SCHRANKE_ENGLISCH}\n${englisch.join('\n')}`,
  );

  const SCHRANKE_ZAHL = 545;
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
    const fabrik = `src/${s.split('.')[0]}/bereich.ts`;
    return ![...q].some(([datei, text]) => datei !== fabrik && muster.test(text));
  });
  assert.deepEqual(ohne, [], 'Schlüssel ohne Aufrufer ausserhalb der Tests');
});
