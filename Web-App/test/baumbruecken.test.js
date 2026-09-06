'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Die Bruecken zwischen den beiden Baeumen duerfen nicht ins Leere zeigen.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Vier von sechs Sicherheitsbefunden dieser Runde hatten dieselbe Ursache:
 * eine Regel, die nur EINE der beiden Oberflaechen kannte (der XML-Maskierer
 * der Wunschliste, die Set-Tabelle, der Preisverlauf, die Zeitplan-Werte).
 *
 * Dagegen tut dieser Baum schon das Richtige: 34 Web-Tests greifen in den
 * Android-Baum und halten Regeln fuer BEIDE Seiten fest. Was diese Kultur
 * nicht schuetzt, ist sie selbst — wird eine Kotlin-Datei umbenannt oder
 * verschoben, zeigt der Pfad im Web-Test ins Leere. Je nach Test heisst das:
 * ein Absturz mit unklarer Meldung, oder — schlimmer — eine Pruefung, die
 * nichts mehr findet und deshalb schweigt.
 *
 * Genau diese Fehlerart hat in dieser Sitzung schon zweimal zugeschlagen
 * (SelbstUpdateTest mit einer Ebene zu wenig; und beim Bauen DIESER Pruefung
 * habe ich selbst zweimal die falsche Basis gerechnet und 14 gesunde Pfade
 * als kaputt gemeldet).
 *
 * ── Was der Test kann und was nicht ─────────────────────────────────────────
 * Aufgeloest werden `path.join(<basis>, …)`-Aufrufe, deren Segmente alle
 * Zeichenketten sind. Die Basis wird aus der Datei selbst bestimmt:
 * `__dirname` ist test/, eine Hilfsvariable wird ueber ihre eigene Definition
 * aufgeloest — REKURSIV, und das ist der Punkt.
 *
 * Der erste Entwurf suchte nur Aufrufe, in denen das Wort 'Android-App'
 * woertlich steht. Die Tests schreiben es aber genau EINMAL:
 *
 *     const APP = path.join(WURZEL, '..', 'Android-App', …);
 *     …
 *     fs.readFileSync(path.join(APP, 'util', 'BrickLinkWunschliste.kt'))
 *
 * Damit prueft die erste Fassung den BASISORDNER — und der verschwindet fast
 * nie. Die einzelnen .kt-Dateien verschwinden. Die Gegenprobe hat es gezeigt:
 * BrickLinkWunschliste.kt umbenannt, und der Test schwieg.
 *
 * Nicht aufloesbar sind Pfade mit einem VARIABLEN Segment
 * (`…, 'res', ordner, 'strings.xml'`). Die werden gezaehlt und gemeldet,
 * nicht stillschweigend uebergangen: Eine Pruefung, die verschweigt, was sie
 * ausgelassen hat, ist die naechste Luecke.
 */

/**
 * Kommentare raus — zeilenweise, nicht ueber einen Regex auf Blockkommentare.
 * Begruendung siehe test/hsts.test.js: Ein Regex haelt das `/*` in
 * '/data/instructions/*' fuer einen Kommentaranfang und frisst den halben Baum.
 */
function ohneKommentare(s) {
  const zeilen = [];
  let imBlock = false;
  for (const z of s.split('\n')) {
    const t = z.trim();
    if (imBlock) { zeilen.push(''); if (t.endsWith('*/')) imBlock = false; continue; }
    if (t.startsWith('/*')) { zeilen.push(''); if (!t.includes('*/')) imBlock = true; continue; }
    zeilen.push(t.startsWith('//') || t.startsWith('*') ? '' : z);
  }
  return zeilen.join('\n');
}

const TESTORDNER = __dirname;
const WEBAPP = path.join(__dirname, '..');

/**
 * Wofuer steht die Basis-Variable eines path.join(...) in DIESER Datei?
 *
 * Rekursiv, weil die Tests in zwei Stufen bauen: `ROOT` aus `__dirname`, dann
 * `APP` aus `ROOT`. `tiefe` bricht einen Ringbezug ab, statt sich aufzuhaengen.
 */
function basisOrdner(quelle, name, tiefe = 0) {
  if (name === '__dirname') return TESTORDNER;
  if (tiefe > 4) return null;
  const m = new RegExp(`const ${name}\\s*=\\s*path\\.join\\(([^)]*)\\)`, 's').exec(quelle);
  if (!m) return null;
  const teile = m[1].split(',').map(s => s.trim()).filter(Boolean);
  const basis = basisOrdner(quelle, teile[0], tiefe + 1);
  if (!basis) return null;
  const segmente = teile.slice(1).map(s => /^'([^']*)'$/.exec(s)?.[1]);
  if (segmente.some(s => s === undefined)) return null;
  return path.join(basis, ...segmente);
}

/**
 * Welche Variablen dieser Datei zeigen in den Android-Baum?
 *
 * Gesucht wird ueber den AUFGELOESTEN Pfad, nicht ueber den Namen: `APP`,
 * `ANDROID`, `KT` — die Tests nennen sie verschieden, und eine Namensliste
 * hier waere die naechste Stelle, die still veraltet.
 */
function androidBasen(quelle) {
  const gefunden = new Map();
  for (const m of quelle.matchAll(/const ([A-Za-z_$][\w$]*)\s*=\s*path\.join\(/g)) {
    const ziel = basisOrdner(quelle, m[1]);
    if (ziel && ziel.includes(`${path.sep}Android-App${path.sep}`)) gefunden.set(m[1], ziel);
  }
  return gefunden;
}

/** Alle Bruecken in den Android-Baum, aufgeloest so weit es geht. */
function bruecken() {
  const aufgeloest = [];
  const offen = [];
  for (const datei of fs.readdirSync(TESTORDNER).filter(f => f.endsWith('.test.js')).sort()) {
    // Kommentare raus, BEVOR gemessen wird: Ein Erklaerblock, der einen Pfad
    // als Beispiel zeigt, ist kein Zugriff. Diese Datei selbst ist der beste
    // Beleg — ihr eigener Block darueber nennt zwei, und der erste Entwurf
    // meldete sie prompt als „nicht aufloesbar".
    //
    // Zeilenweise, weil ein Regex auf /* … */ an Routen wie
    // '/data/instructions/*' scheitert (der Fund aus test/hsts.test.js).
    const quelle = ohneKommentare(fs.readFileSync(path.join(TESTORDNER, datei), 'utf8'));
    if (!quelle.includes('Android-App')) continue;
    const basen = androidBasen(quelle);
    // ZWEI Sorten von Bruecken, und beide werden gebraucht:
    //
    //  1. die Definition selbst — `path.join(WURZEL, '..', 'Android-App', …)`;
    //     ihre Basis ist die Webapp, erkennbar am Wort im Ausdruck
    //  2. jeder spaetere Zugriff darauf — `path.join(APP, 'util', 'X.kt')`;
    //     dort steht das Wort nicht mehr, und genau DAS sind die Dateien, die
    //     verschwinden
    //
    // Der zweite Entwurf hatte 1 durch 2 ERSETZT statt ergaenzt und fand
    // daraufhin fuenf statt sechzehn. Der Selbstbeweis darunter hat es
    // gemeldet.
    if (!basen.size && !quelle.includes('Android-App')) continue;
    for (const m of quelle.matchAll(/path\.join\(\s*([A-Za-z_$][\w$]*)\s*,([^;)]*)\)/gs)) {
      const ueberVariable = basen.has(m[1]);
      const woertlich = m[2].includes("'Android-App'");
      if (!ueberVariable && !woertlich) continue;
      const basis = ueberVariable ? basen.get(m[1]) : basisOrdner(quelle, m[1]);
      const roh = m[2].split(',').map(s => s.trim()).filter(Boolean);
      const segmente = roh.map(s => /^'([^']*)'$/.exec(s)?.[1]);
      if (!basis || segmente.some(s => s === undefined)) {
        offen.push({ datei, ausdruck: m[2].replace(/\s+/g, ' ').trim().slice(0, 70) });
        continue;
      }
      aufgeloest.push({ datei, pfad: path.resolve(basis, ...segmente) });
    }
  }
  return { aufgeloest, offen };
}

test('keine Bruecke in den Android-Baum zeigt ins Leere', () => {
  const { aufgeloest } = bruecken();

  // Selbstbeweis: Findet das Muster nichts, prueft die Zusicherung darunter
  // nichts und waere still gruen. GEMESSEN sind es sechzehn.
  assert.ok(aufgeloest.length >= 12,
    `Nur ${aufgeloest.length} aufloesbare Bruecken gefunden — Muster veraltet? ` +
    'Ohne Treffer prueft dieser Test nichts und waere trotzdem gruen.');

  const tot = aufgeloest.filter(b => !fs.existsSync(b.pfad));
  assert.deepStrictEqual(tot.map(b => `${b.datei} -> ${path.relative(WEBAPP, b.pfad)}`), [],
    'Diese Web-Tests greifen auf eine Datei im Android-Baum zu, die es nicht ' +
    'mehr gibt. Je nach Test heisst das Absturz oder — schlimmer — eine ' +
    'Pruefung, die nichts findet und deshalb schweigt.');
});

test('was sich nicht aufloesen laesst, wird benannt', () => {
  // Eine Pruefung, die verschweigt, was sie ausgelassen hat, ist die naechste
  // Luecke. Diese Zusicherung verbietet die offenen Faelle NICHT — sie haelt
  // nur fest, dass es wenige bleiben und dass sie sichtbar sind.
  const { offen } = bruecken();
  // GEMESSEN: null offene, sechzehn aufgeloeste. Der einzige Fall (preis-herkunft.test.js mit einem
  // variablen Ordnernamen) ist ausgeschrieben worden, als diese Pruefung ihn
  // meldete — der Gewinn an Kuerze war einer, den niemand sieht.
  //
  // Die Schwelle steht trotzdem auf eins statt null: Es kann einen Pfad geben,
  // der sich nur berechnen laesst. Einer faellt auf und wird begruendet; beim
  // zweiten faengt eine Gewohnheit an.
  assert.ok(offen.length <= 1,
    `${offen.length} Bruecken lassen sich nicht aufloesen (erlaubt: 1):\n  ` +
    offen.map(o => `${o.datei}: ${o.ausdruck}`).join('\n  ') +
    '\nEin variables Segment im Pfad nimmt dieser Pruefung die Sicht. Wo es ' +
    'geht, gehoert der Pfad ausgeschrieben.');
});

test('beide Baeume pruefen einander', () => {
  // Die Gegenrichtung: Auch der Android-Baum liest den Web-Baum
  // (SetnummerKorpusTest, CatalogYearMathTest, OcrSetNumberTest). Faellt das
  // weg, ist die Paritaet wieder einseitig — und einseitig war sie bei jedem
  // der vier Befunde.
  const kt = path.join(WEBAPP, '..', 'Android-App', 'app', 'src', 'test',
    'java', 'ch', 'brickinventoryapp');
  assert.ok(fs.existsSync(kt), `Der Android-Testordner fehlt: ${kt}`);
  const rueckwaerts = fs.readdirSync(kt).filter(f =>
    f.endsWith('.kt') && fs.readFileSync(path.join(kt, f), 'utf8').includes('Web-App'));
  assert.ok(rueckwaerts.length >= 3,
    `Nur ${rueckwaerts.length} Android-Tests lesen noch den Web-Baum (erwartet: mindestens 3). ` +
    'Die Paritaet darf nicht einseitig werden.');
});
