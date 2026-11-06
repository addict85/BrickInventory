const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ORDNER = path.join(__dirname, '..', 'src/finanzen/rechnung');

/**
 * Die Finanzschicht steht aufeinander — und zwar in EINE Richtung.
 * Ausführlich: docs/begruendungen/test/finanz-schichten.test.js.md#stelle
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
    'Die Dateien unter src/finanzen/rechnung/ stimmen nicht mehr mit der Schichtung ' +
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
  // src/finanzen/financeCalc.ts ist die Tuer fuer 16 Aufrufstellen. Steht dort wieder
  // Logik, waechst sie zurueck auf 1529 Zeilen.
  const fassade = fs.readFileSync(path.join(__dirname, '..', 'src/finanzen/financeCalc.ts'), 'utf8');
  const ohneKommentar = fassade.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(z => !/^\s*\/\//.test(z)).join('\n').trim();
  const zeilen = ohneKommentar.split('\n').filter(z => z.trim()).length;
  assert.ok(zeilen <= 25,
    `Die Fassade hat ${zeilen} Zeilen Code. Sie soll nur weiterreichen.`);
  assert.ok(!/\bfunction\b|\bdb\./.test(ohneKommentar),
    'In der Fassade steht wieder Logik. Sie gehoert in die Schicht, zu der sie ' +
    'passt — dafuer gibt es src/finanzen/rechnung/.');
});

test('Blickfeld ist an einer Stelle erklaert', () => {
  // Ein Name, zwei Bedeutungen
  // Ausführlich: docs/begruendungen/test/finanz-schichten.test.js.md#wurzel
  const wurzel = path.join(__dirname, '..');
  const treffer = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'test'].includes(n)) continue;
        lauf(p);
      } else if (n.endsWith('.ts')) {
        const s = fs.readFileSync(p, 'utf8');
        if (/^\s*(export )?type Blickfeld\w* =/m.test(s)) {
          treffer.push(path.relative(wurzel, p).split(path.sep).join('/'));
        }
      }
    }
  })(wurzel);
  assert.deepEqual(treffer, ['src/haushalt/haushalt.ts'],
    'Der Typ Blickfeld wird an mehr als einer Stelle erklaert. Er gehoert dort ' +
    'hin, wo asIds() steht — sonst driften die Fassungen auseinander, und eine ' +
    'Signatur sagt nicht mehr, ob sie vor oder nach der Normalisierung steht.');
});
