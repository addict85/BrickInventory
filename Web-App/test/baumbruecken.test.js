'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Die Bruecken zwischen den beiden Baeumen duerfen nicht ins Leere zeigen.
 * Ausführlich: docs/begruendungen/test/baumbruecken.test.js.md#stelle
 *
 * Damit prueft die erste Fassung den BASISORDNER — und der verschwindet fast
 * nie. Die einzelnen .kt-Dateien verschwinden. Die Gegenprobe hat es gezeigt:
 * BrickLinkWunschliste.kt umbenannt, und der Test schwieg.
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
    // Ausführlich: docs/begruendungen/test/baumbruecken.test.js.md#quelle
    const quelle = ohneKommentare(fs.readFileSync(path.join(TESTORDNER, datei), 'utf8'));
    if (!quelle.includes('Android-App')) continue;
    const basen = androidBasen(quelle);
    // ZWEI Sorten von Bruecken, und beide werden gebraucht:
    // Ausführlich: docs/begruendungen/test/baumbruecken.test.js.md#if-stelle
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
  // Ausführlich: docs/begruendungen/test/baumbruecken.test.js.md#stelle-2
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
  // Die Tests liegen seit der Aufteilung der App in den Modulen neben ihrem Code.
  const ordner = require('./helpers/android').quellwurzeln('test');
  assert.ok(ordner.length >= 2, `Nur ${ordner.length} Android-Testordner gefunden`);
  // Rekursiv: Jedes Modul legt seine Tests unter den eigenen Paketstamm (<stamm>/).
  const rueckwaerts = ordner.flatMap(kt => fs.readdirSync(kt, { recursive: true }).map(String).filter(f =>
    f.endsWith('.kt') && fs.readFileSync(path.join(kt, f), 'utf8').includes('Web-App')));
  assert.ok(rueckwaerts.length >= 3,
    `Nur ${rueckwaerts.length} Android-Tests lesen noch den Web-Baum (erwartet: mindestens 3). ` +
    'Die Paritaet darf nicht einseitig werden.');
});
