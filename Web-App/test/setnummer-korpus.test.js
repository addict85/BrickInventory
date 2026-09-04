/**
 * Der GEMEINSAME Korpus: Web-App und Android-App müssen dieselbe Setnummer
 * lesen.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * Dieselbe Frage — „welche Zahl in diesem Text ist die Setnummer?" — wird
 * zweimal beantwortet: hier in `utils/produkttitel.ts` für Händlertitel, und
 * in Kotlin (`setNumberCandidates`) für die Texterkennung. Ein gemeinsamer
 * Aufruf geht nicht: Die App liest offline in der Kameraschleife.
 *
 * NACHGEMESSEN, bevor es diesen Korpus gab:
 *
 *   Regel                                    Server   App
 *   Mengenangabe („3696 Pcs") aussortieren     ja     NEIN
 *   Jahreszahl zurückstufen                    ja     NEIN
 *   nach Stellenzahl ordnen (5, 4, 6, 7)      NEIN     ja
 *   dreistellige Setnummern (375, 928)        NEIN    NEIN
 *
 * Zwei Fassungen, zwei verschiedene Antworten — und beide verfehlten alte
 * dreistellige Sets vollständig („928 GALAXY EXPLORER" → gar kein Kandidat).
 *
 * ── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
 *
 * Die Fälle stehen in shared/setnummer-korpus.json, samt Begründung je Fall.
 * Ein neuer Fall wird EINMAL eingetragen und prüft ab sofort beide Apps; die
 * Gegenprobe auf der anderen Seite ist SetnummerKorpusTest.kt.
 *
 * Weil ein Korpus allein nur beweist, dass beide dieselben BEISPIELE bestehen,
 * werden zusätzlich die beiden Stellen verglichen, an denen die Regel als DATEN
 * steht: die Güte-Reihenfolge und das Mengenwort-Muster. Sie müssen wortgleich
 * sein — sonst laufen die Apps zwischen den Beispielen auseinander.
 *
 * Selbstbeweis über Mindestzahlen: Griffe das Einlesen nicht, wären die
 * Schleifen leer und der Test grün, ohne etwas geprüft zu haben.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { setnummerKandidaten, GUETE } = _req('utils/produkttitel.js');

const ROOT = path.join(__dirname, '..');
const KORPUS_DATEI = path.join(ROOT, '..', 'shared', 'setnummer-korpus.json');
const KOTLIN = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main', 'java',
  'ch', 'brickinventoryapp', 'ui', 'screens', 'BarcodeScannerScreen.kt');
const KOTLIN_TEST = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'test', 'java',
  'ch', 'brickinventoryapp', 'SetnummerKorpusTest.kt');

const korpus = JSON.parse(fs.readFileSync(KORPUS_DATEI, 'utf8')).faelle;

/**
 * Kommentare weg, bevor im Quelltext gesucht wird.
 *
 * GEGENPROBE, die das ausgelöst hat: Ich habe den Pfad im Kotlin-Test auf eine
 * andere Datei gebogen — und die Prüfung unten blieb GRÜN, weil der Pfad im
 * Kopfkommentar derselben Datei noch einmal steht. Eine Prüfung, die auf einen
 * Kommentar hereinfällt, prüft nichts.
 */
function ohneKommentare(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('jeder Fall des gemeinsamen Korpus liefert denselben ersten Kandidaten', () => {
  let mitErwartung = 0, ohneKandidat = 0, dreistellig = 0;
  for (const [i, fall] of korpus.entries()) {
    const k = setnummerKandidaten(fall.text);
    const ist = k[0] ?? null;
    assert.equal(ist, fall.erwartet,
      `Korpusfall ${i}: ${JSON.stringify(fall.text)}\n` +
      `  erwartet: ${fall.erwartet}\n  bekommen: ${ist}  (alle: ${JSON.stringify(k)})\n` +
      `  warum: ${fall.warum}`);
    if (fall.erwartet === null) ohneKandidat++; else mitErwartung++;
    if (fall.erwartet !== null && fall.erwartet.length === 3) dreistellig++;
  }

  // Selbstbeweis 1: Der Korpus wurde wirklich gelesen.
  assert.ok(korpus.length >= 15, `nur ${korpus.length} Fälle — Datei geschrumpft?`);
  // Selbstbeweis 2: Beide Richtungen sind vertreten. Ohne das könnte der Korpus
  // zu lauter Nulltreffern verkommen und trotzdem grün sein.
  assert.ok(mitErwartung >= 10, `nur ${mitErwartung} Fälle mit erwarteter Nummer`);
  assert.ok(ohneKandidat >= 2, `nur ${ohneKandidat} Fälle, die gar nichts liefern dürfen`);
  // Selbstbeweis 3: Der Anlass dieser Runde — dreistellige Altsets — ist
  // abgedeckt. Fällt die Unterstützung wieder raus, wird es rot.
  assert.ok(dreistellig >= 2, `nur ${dreistellig} dreistellige Setnummern im Korpus`);
});

test('jeder Korpusfall hat eine Begründung', () => {
  // Ein Fall ohne `warum` ist in einem halben Jahr nicht mehr zu bewerten —
  // und wer ihn dann rot sieht, weiss nicht, ob er ihn ändern darf.
  for (const [i, fall] of korpus.entries()) {
    assert.equal(typeof fall.text, 'string', `Fall ${i} ohne Text`);
    assert.ok((fall.warum || '').length >= 20, `Fall ${i} ohne Begründung: ${fall.warum}`);
    assert.ok(fall.erwartet === null || typeof fall.erwartet === 'string',
      `Fall ${i}: "erwartet" muss ein String oder null sein`);
  }
});

test('die Güte-Reihenfolge steht in beiden Apps gleich', () => {
  const kt = fs.readFileSync(KOTLIN, 'utf8');
  const m = kt.match(/val GUETE = listOf\(([\d,\s]+)\)/);
  assert.ok(m, 'GUETE in BarcodeScannerScreen.kt nicht gefunden — umbenannt?');
  const kotlinGuete = m[1].split(',').map(s => Number(s.trim()));
  assert.deepEqual(kotlinGuete, GUETE,
    'Die App ordnet Stellenzahlen anders als der Server — genau die stille ' +
    'Abweichung, wegen der es diesen Korpus gibt.');
  // Selbstbeweis: eine leere Liste würde oben gegen eine leere Liste bestehen.
  assert.ok(GUETE.length >= 4, `GUETE hat nur ${GUETE.length} Einträge`);
});

test('das Mengenwort-Muster steht in beiden Apps gleich', () => {
  const ts = fs.readFileSync(path.join(ROOT, 'utils', 'produkttitel.ts'), 'utf8');
  const mTs = ts.match(/const MENGENWORT = \/(.+)\/i;/);
  assert.ok(mTs, 'MENGENWORT in produkttitel.ts nicht gefunden');

  const kt = fs.readFileSync(KOTLIN, 'utf8');
  const mKt = kt.match(/val MENGENWORT = Regex\(([\s\S]*?)\n\)/);
  assert.ok(mKt, 'MENGENWORT in BarcodeScannerScreen.kt nicht gefunden');
  // Kotlin schreibt das Muster als zusammengesetzte Zeichenketten mit doppelt
  // maskierten Rückstrichen; `(?iu)` ist dort nötig, weil Javas Ignorieren der
  // Gross-/Kleinschreibung sonst auf ASCII beschränkt bleibt (Umlaute!).
  const kotlinMuster = (mKt[1].match(/"(?:[^"\\]|\\.)*"/g) || [])
    .map(s => s.slice(1, -1)).join('')
    .replace(/\\\\/g, '\\')
    .replace('(?iu)', '');
  assert.equal(kotlinMuster, mTs[1],
    'Die App sortiert andere Mengenangaben aus als der Server.');
  assert.ok(mTs[1].length >= 40, `Muster verdächtig kurz: ${mTs[1]}`);
});

test('die App prüft denselben Korpus', () => {
  // Ohne das könnte die Kotlin-Seite den Korpus still fallen lassen: Hier wäre
  // weiter alles grün, und die Behauptung „beide Apps antworten gleich" wäre
  // nur noch eine Behauptung.
  const src = ohneKommentare(fs.readFileSync(KOTLIN_TEST, 'utf8'));
  assert.ok(src.includes('shared/setnummer-korpus.json'),
    'SetnummerKorpusTest.kt liest den gemeinsamen Korpus nicht mehr');
  assert.ok(src.includes('setNumberCandidates'),
    'SetnummerKorpusTest.kt ruft die Kotlin-Fassung nicht mehr auf');
});
