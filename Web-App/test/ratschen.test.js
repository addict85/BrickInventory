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

/**
 * Treffer zaehlen — im CODE, nicht in den Erklaerungen darueber.
 *
 * ── Warum ohneKommentare() (Nachtrag 175) ───────────────────────────────────
 *
 * Diese Ratsche schlug an, als jemand in einem Kommentar BEGRUENDETE, warum er
 * an einer Stelle KEIN `as any` schreibt. Der Zaehler stieg um zwei, obwohl im
 * Code eines weniger stand.
 *
 * Das ist kein Randfall, sondern die Regel, die sich selbst im Weg steht: Eine
 * Ratsche, die Erklaerungen mitzaehlt, bestraft genau das Verhalten, das sie
 * erreichen will — sie macht das Aufschreiben der Begruendung teurer als das
 * stille Hinnehmen. Derselbe Fehler steckte in diesem Baum schon in
 * design-haftung, noppe-design und csv-prototyp; er faellt jedes Mal erst auf,
 * wenn jemand die Regel dokumentiert.
 */
function zaehle(muster) {
  const { ohneKommentare } = require('./helpers/sources');
  let n = 0;
  for (const f of quellen()) {
    const s = ohneKommentare(fs.readFileSync(f, 'utf8'));
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
  // GEMESSEN am 19.09.2026 nach Nachtrag 175: 325. Die Schranke stand auf
  // 340, solange der Zaehler auch Kommentare las.
  // GEMESSEN am 20.10.2026: 323. Die Ratsche hatte beim Auftragsdatensatz des
  // Wanted-Imports angeschlagen (327 gegen 325); statt die Schranke zu heben
  // sind die vier neuen Faenge sprechend gemacht worden — zwei brauchte es gar
  // nicht (die Meldekette traegt ihr logAndContinue schon), zwei melden jetzt
  // ueber meldeUndWeiter. Die Schranke zieht nach, wie die Regel es vorsieht.
  const SCHRANKE = 323;
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
  // GEMESSEN am 19.09.2026 nach Nachtrag 175: 398 Stellen. Es waren 402,
  // solange der Zaehler auch Kommentare las.
  const SCHRANKE = 398;
  const ist = zaehle([/\bas any\b/g, /:\s*any\b/g]);
  assert.ok(ist <= SCHRANKE,
    `${ist}-mal \`any\`, erlaubt sind ${SCHRANKE}. Jedes davon schaltet den ` +
    'Typpruefer fuer diesen Ausdruck ab — in einem Baum, der sonst auf ' +
    'noImplicitAny mit leerer Ausnahmeliste steht.');
  if (ist < SCHRANKE) {
    console.log(`  ℹ any: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

/**
 * Testdateien, die nur Quelltext lesen und nichts ausführen. Eine Regex auf
 * den Quelltext bestätigt, dass eine Zeile dasteht — nicht, dass sie wirkt
 * (der Signal-Fehler vom 25.10. stand im Quelltext, nur an der falschen
 * Stelle). Strukturprüfungen dürfen bleiben; neue Prüfungen von Verhalten
 * gehören in einen Test, der den Code laufen lässt.
 */
const LIEST_QUELLE = /readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare/;
const FUEHRT_AUS = /buildAndRequire|testServer|spawn\(|spawnSync\(|execFileSync\(|fetch\(|jsdom|new Function|vm\./;
function reineQuelltextTests() {
  return fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js')).filter(n => {
    const src = fs.readFileSync(path.join(__dirname, n), 'utf8');
    return LIEST_QUELLE.test(src) && !FUEHRT_AUS.test(src);
  });
}

test('reine Quelltext-Tests werden weniger, nie mehr', () => {
  // GEMESSEN am 25.10.2026: 103 von 312 Testdateien.
  const SCHRANKE = 103;
  const alle = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js')).length;
  assert.ok(alle >= 300, `Nur ${alle} Testdateien gefunden — greift die Suche noch?`);
  const ist = reineQuelltextTests();
  assert.ok(ist.length <= SCHRANKE,
    `${ist.length} Testdateien lesen nur Quelltext, erlaubt sind ${SCHRANKE}. ` +
    'Prüft der neue Test Verhalten, soll er den Code ausführen (buildAndRequire, ' +
    'testServer) statt per Regex nachzusehen, ob eine Zeile dasteht.');
  if (ist.length < SCHRANKE) {
    console.log(`  ℹ reine Quelltext-Tests: ${ist.length} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
  }
});

/**
 * Emoji in der Oberfläche. Seit dem 25.10. gibt es eine Symbolfamilie (Sprite
 * in index.html); Emoji sehen je Gerät anders aus und passen weder in Grösse
 * noch Farbe dazu. Gezählt werden Markup, deutsche Sprachtexte und die
 * Vorlagen in public/js — ohne Kommentare.
 */
function emojiInDerOberflaeche() {
  const web = path.join(WEB, 'public');
  const ohne = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const dateien = [path.join(web, 'index.html'), path.join(web, 'locales', 'de.js'),
    ...fs.readdirSync(path.join(web, 'js')).filter(n => /^\d\d-.*\.js$/.test(n)).map(n => path.join(web, 'js', n))];
  return dateien.reduce((n, f) => n + (ohne(fs.readFileSync(f, 'utf8')).match(/\p{Extended_Pictographic}/gu) || []).length, 0);
}

test('Emoji in der Oberfläche werden weniger, nie mehr', () => {
  // GEMESSEN am 25.10.2026: 275, nachdem Leiste und Benutzermenü auf die
  // Symbolfamilie umgestellt waren; 274 nach den Erfassen-Dialogen; 0 am 27.10.
  // Am 27.10. auf 0: Alle Stellen nutzen die Symbolfamilie oder kommen ohne aus.
  const SCHRANKE = 0;
  const ist = emojiInDerOberflaeche();
  // Selbstbeweis an einer Probe statt an der Zahl — die ist jetzt 0.
  assert.equal(('<b>📦 x</b> ⚠️').match(/\p{Extended_Pictographic}/gu)?.length, 2, 'Die Suche greift nicht mehr');
  assert.ok(ist <= SCHRANKE,
    `${ist} Emoji in der Oberfläche, erlaubt sind ${SCHRANKE}. Für Symbole gibt es ` +
    'die Symbolfamilie: <svg class="ico" aria-hidden="true"><use href="#i-…"/></svg>.');
  if (ist < SCHRANKE) console.log(`  ℹ Emoji: ${ist} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});
