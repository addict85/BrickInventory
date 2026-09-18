const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');

/**
 * Zwei Ratschen: der Bestand darf sinken, nie steigen.
 *
 * ── Warum eine Ratsche und keine harte Regel ────────────────────────────────
 *
 * Marcos Frage war, ob es in Sicherheit, Architektur und Codequalitaet noch
 * etwas anzugehen gibt. Zwei Zahlen stechen heraus, und beide sind zu gross
 * fuer einen Durchgang:
 *
 *   • STILLE FAENGE — `catch {}` und `.catch(() => null)`. Jeder einzelne kann
 *     richtig sein (ein fehlendes Vorschaubild ist kein Fehler). Zusammen sind
 *     sie die Stellen, an denen die Anwendung etwas verschluckt und weiterlaeuft
 *     — genau das hat in dieser Sitzung dreimal Stunden gekostet.
 *
 *   • `any` — jedes davon schaltet den Typpruefer fuer diesen Ausdruck ab.
 *     Der Baum steht sonst auf `noImplicitAny` mit leerer Ausnahmeliste; diese
 *     Stellen sind die verbliebenen Loecher darin.
 *
 * Sie alle auf einmal anzufassen waere ein Umbau von hunderten Stellen, jede
 * mit eigener Begruendung, und niemand koennte das Ergebnis pruefen. Eine harte
 * Regel waere sofort rot und muesste hunderte Ausnahmen auffuehren — eine
 * Ausnahmeliste dieser Laenge liest niemand mehr.
 *
 * Die Ratsche loest beides, genau wie AbstandsskalaTest in der App: Sie haelt
 * den GEMESSENEN Stand fest, laesst ihn sinken und schlaegt an, sobald er
 * steigt. Neuer Code bekommt damit den hoeheren Anspruch, ohne dass der
 * Bestand angefasst werden muss.
 *
 * ── Wer die Schranke senkt ──────────────────────────────────────────────────
 *
 * Wer eine Stelle aufraeumt, setzt die Zahl hier herunter. Das ist Absicht:
 * Die Schranke soll den Fortschritt festhalten, sonst schleicht er zurueck.
 */

/** Alle TypeScript-Quellen ohne Tests und ohne Erzeugnisse. */
function quellen() {
  const raus = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'coverage', 'test'].includes(n)) continue;
        lauf(p);
      } else if (n.endsWith('.ts')) raus.push(p);
    }
  })(WEB);
  return raus;
}

const STILLE_FAENGE = [
  /catch\s*\{\s*\}/g,
  /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
  /\.catch\(\(\)\s*=>\s*\{\s*\}\)/g,
  /\.catch\(\(\)\s*=>\s*(null|undefined|0|false)\)/g,
];

function zaehle(muster) {
  let n = 0;
  for (const f of quellen()) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of muster) n += (s.match(m) || []).length;
  }
  return n;
}

test('die Suche findet die Quellen ueberhaupt', () => {
  // ── Der eigentliche Zweck dieser Pruefung ────────────────────────────────
  //
  // Wird ein Ordner umbenannt oder greift `quellen()` nicht mehr, zaehlen die
  // Ratschen unten NULL — und null ist kleiner als jede Schranke. Sie waeren
  // dann fuer immer gruen, ohne je wieder etwas anzusehen.
  const n = quellen().length;
  assert.ok(n >= 80, `Nur ${n} TypeScript-Quellen gefunden — greift die Suche noch?`);
});

test('stille Faenge werden weniger, nie mehr', () => {
  // GEMESSEN am 18.09.2026: 340 Stellen in 97 Dateien.
  const SCHRANKE = 340;
  const ist = zaehle(STILLE_FAENGE);
  assert.ok(ist <= SCHRANKE,
    `${ist} stille Faenge, erlaubt sind ${SCHRANKE}. Ein neuer \`catch {}\` ` +
    'verschluckt einen Fehler und laeuft weiter — im Betrieb sieht man dann ' +
    'ein Verhalten ohne Ursache. Entweder den Fehler behandeln, oder ihn ' +
    'wenigstens melden (meldeUndWeiter aus utils/fehlerTexte).');
  if (ist < SCHRANKE) {
    console.log(`  ℹ stille Faenge: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

test('any wird weniger, nie mehr', () => {
  // GEMESSEN am 18.09.2026: 402 Stellen.
  const SCHRANKE = 402;
  const ist = zaehle([/\bas any\b/g, /:\s*any\b/g]);
  assert.ok(ist <= SCHRANKE,
    `${ist}-mal \`any\`, erlaubt sind ${SCHRANKE}. Jedes davon schaltet den ` +
    'Typpruefer fuer diesen Ausdruck ab — in einem Baum, der sonst auf ' +
    'noImplicitAny mit leerer Ausnahmeliste steht.');
  if (ist < SCHRANKE) {
    console.log(`  ℹ any: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});
