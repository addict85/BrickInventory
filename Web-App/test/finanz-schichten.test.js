const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ORDNER = path.join(__dirname, '..', 'utils', 'finance');

/**
 * Die Finanzschicht steht aufeinander — und zwar in EINE Richtung.
 *
 * ── Warum es diese Pruefung gibt (Nachtrag 171) ─────────────────────────────
 *
 * utils/financeCalc.ts trug 1529 Zeilen und drei Aufgaben. Getrennt sieht die
 * Ordnung so aus:
 *
 *     zustand.ts        die eine Zustandsregel — haengt an nichts
 *     abfragen.ts       Lesezugriffe, die mehr als eine Schicht braucht
 *     preise.ts         BrickLink, Zwischenspeicher, Anfragekontingent
 *     bewertung.ts      was ist der Bestand heute wert
 *     gewinnVerlust.ts  was hat er gekostet, was gebracht
 *
 * Diese Reihenfolge ist keine Geschmacksfrage: Ein Griff nach oben — die
 * Preisschicht fragt die Bewertung — waere ein Kreis, und Node laedt im Kreis
 * ein halb fertiges Modul aus. Das faellt nicht beim Uebersetzen auf, sondern
 * zur Laufzeit und nur manchmal.
 *
 * ── Warum ich sie nicht geraten habe ────────────────────────────────────────
 *
 * Meine erste Annahme war falsch: Ich hielt die Gewinnrechnung fuer
 * unabhaengig. Sie ruft die Bewertungen auf und sitzt damit UEBER ihnen.
 * Aufgefallen ist das erst, als `tsc` nach dem ersten Schnitt
 * `Cannot find name computePartsValuation` meldete. Diese Pruefung haelt fest,
 * was der Compiler gezeigt hat.
 */

/** Die Reihenfolge — wer weiter unten steht, darf nichts weiter oben holen. */
const SCHICHTEN = ['zustand', 'abfragen', 'preise', 'bewertung', 'gewinnVerlust'];

function importeVon(name) {
  const s = fs.readFileSync(path.join(ORDNER, `${name}.ts`), 'utf8');
  // Nur Geschwister in derselben Schicht-Familie: './x'
  return [...s.matchAll(/(?:import|from)\s+['"]\.\/(\w+)['"]/g)].map(m => m[1]);
}

test('die Schichten sind vollstaendig da', () => {
  // Selbstbeweis: Fehlt eine Datei, pruefte die Schleife unten Luft.
  const da = fs.readdirSync(ORDNER).filter(n => n.endsWith('.ts'))
    .map(n => path.basename(n, '.ts')).sort();
  assert.deepEqual(da, [...SCHICHTEN].sort(),
    'Die Dateien unter utils/finance/ stimmen nicht mehr mit der Schichtung ' +
    'ueberein. Kommt eine dazu, gehoert sie an ihren Platz in SCHICHTEN — ' +
    'sonst prueft hier niemand ihre Richtung.');
});

test('keine Schicht greift nach oben', () => {
  const fehler = [];
  let kanten = 0;
  SCHICHTEN.forEach((name, hoehe) => {
    for (const ziel of importeVon(name)) {
      const zielHoehe = SCHICHTEN.indexOf(ziel);
      if (zielHoehe < 0) continue;            // kein Geschwister der Schicht
      kanten++;
      if (zielHoehe >= hoehe) {
        fehler.push(`${name}.ts holt ${ziel}.ts — das steht gleich hoch oder hoeher`);
      }
    }
  });
  // Selbstbeweis: GEMESSEN gibt es mehrere Kanten. Faende die Suche keine,
  // waere die Zusicherung darunter still gruen.
  assert.ok(kanten >= 4,
    `Nur ${kanten} Abhaengigkeiten zwischen den Schichten gefunden — greift die Suche noch?`);
  assert.deepEqual(fehler, [],
    'Ein Griff nach oben schliesst den Kreis. Node laedt im Kreis ein halb ' +
    'fertiges Modul aus — das faellt nicht beim Uebersetzen auf, sondern zur ' +
    'Laufzeit und nur manchmal.');
});

test('die Fassade reicht nur durch', () => {
  // utils/financeCalc.ts ist die Tuer fuer 16 Aufrufstellen. Steht dort wieder
  // Logik, waechst sie zurueck auf 1529 Zeilen.
  const fassade = fs.readFileSync(path.join(__dirname, '..', 'utils', 'financeCalc.ts'), 'utf8');
  const ohneKommentar = fassade.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(z => !/^\s*\/\//.test(z)).join('\n').trim();
  const zeilen = ohneKommentar.split('\n').filter(z => z.trim()).length;
  assert.ok(zeilen <= 25,
    `Die Fassade hat ${zeilen} Zeilen Code. Sie soll nur weiterreichen.`);
  assert.ok(!/\bfunction\b|\bdb\./.test(ohneKommentar),
    'In der Fassade steht wieder Logik. Sie gehoert in die Schicht, zu der sie ' +
    'passt — dafuer gibt es utils/finance/.');
});
