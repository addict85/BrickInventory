#!/usr/bin/env node
/**
 * noImplicitAny — gestaffelt, mit einer Liste, die nur kürzer werden darf.
 *
 * ── Warum es dieses Skript gibt (Nachtrag 150) ──────────────────────────────
 * `noImplicitAny` meldet noch 631 Stellen, 632 davon ursprünglich derselbe
 * Fall: ein Parameter ohne Typ (TS7006). Den Schalter einfach in tsconfig.json
 * einzuschalten hiesse, den Übersetzer dauerhaft rot zu machen — und ein
 * Übersetzer, der immer rot ist, wird nicht mehr gelesen. Genau diese
 * Begründung stand jahrelang zu Recht bei strictNullChecks.
 *
 * ── Warum keine zweite tsconfig ────────────────────────────────────────────
 * Der naheliegende Weg wäre eine `tsconfig.noimplicitany.json`, die die noch
 * unsauberen Dateien in `exclude` aufführt. Das funktioniert NICHT: `exclude`
 * bestimmt nur, welche Dateien als Einstiegspunkte gesucht werden. Was von
 * einer eingeschlossenen Datei importiert wird, landet trotzdem im Programm
 * und wird mitgeprüft — ausprobiert, es blieben 471 der 631 Meldungen übrig.
 *
 * Deshalb hier ein Skript: Es lässt tsc über ALLES laufen und wertet aus, aus
 * welcher Datei eine Meldung kommt. Der Schalter ist damit für alle Dateien
 * ausser den unten aufgeführten scharf.
 *
 * ── Die Liste ist LEER, und damit hat dieses Skript eine neue Aufgabe ──────
 * Der Abbau ist durch: `noImplicitAny` steht seit dieser Etappe in
 * tsconfig.json auf `true`, `npx tsc --noEmit` ist also selbst die Prüfung.
 *
 * Weshalb das Skript trotzdem bleibt: Den Schalter WIEDER AUSZUSCHALTEN macht
 * den Übersetzer GRÜNER, nicht röter. Das ist die eine Regression, die tsc
 * grundsätzlich nicht melden kann — es gäbe schlicht keine Meldung mehr. Also
 * prüft dieses Skript jetzt die Regel selbst: dass der Schalter an ist.
 *
 * Die Ausnahmeliste bleibt als Mechanik stehen. Wer den nächsten Schalter
 * gestaffelt einführt (strictFunctionTypes, useUnknownInCatchVariables …),
 * findet hier das Gerüst und muss es nicht neu bauen.
 *
 * ── Die Richtung war der Punkt ─────────────────────────────────────────────
 * Die Liste war eine AUSNAHMELISTE, keine Auswahlliste. Eine neue Datei war
 * automatisch streng; Schuld liess sich nur abbauen, nicht mehr stillschweigend
 * anhäufen. Beim Aufräumen einer Datei fiel ihre Zeile weg, sonst nichts.
 *
 *   npm run typecheck:strict
 *
 * Geprüft wird zweierlei, und das Zweite ist das wichtigere:
 *   1. Keine Meldung aus einer Datei ausserhalb der Liste.
 *   2. Kein VERWAISTER Eintrag — eine Datei, die den Schalter längst bestünde
 *      oder die es nicht mehr gibt. Ohne diese Richtung wüchse hier eine
 *      Abschrift heran, die niemand mehr pflegt; genau daran ist in
 *      Nachtrag 149 die Namensraum-Liste gescheitert.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Dateien, die `noImplicitAny` noch NICHT bestehen.
 *
 * Diese Liste darf nur kürzer werden. Wer eine Datei aufräumt, streicht ihre
 * Zeile; wer eine neue Datei anlegt, kommt hier gar nicht erst vor.
 *
 * Stand bei Einführung: 44 offen, 48 bereits sauber.
 * Nachtrag 151: noch 30 offen, 62 sauber.
 * Nachtrag 156: noch 24 offen.
 * Diese Etappe: LEER. Der Schalter steht in tsconfig.json.
 */
// Der Typ steht hier, seit die Liste LEER ist: `new Set([])` ergibt sonst
// Set<never>, und dieses Skript faellt durch seine eigene Pruefung. Genau die
// Sorte Stelle, die es ueberall sonst gemeldet hat.
/** @type {Set<string>} */
const OFFEN = new Set([]);

/** tsc mit noImplicitAny laufen lassen und die Meldungen je Datei sammeln. */
function meldungenJeDatei() {
  let ausgabe = '';
  try {
    execFileSync(process.execPath,
      [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--noImplicitAny'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // execFileSync haengt stdout/stderr an den geworfenen Fehler — genau die
    // brauchen wir hier, denn tsc meldet seine Funde ueber die Ausgabe und
    // beendet sich dabei mit einem Fehlercode. Der Cast benennt das; ein
    // `unknown` liesse sich sonst nicht auslesen, und ein `any` am
    // catch-Parameter waere wieder die Tuer, die dieser Schalter schliesst.
    const p = /** @type {{ stdout?: unknown, stderr?: unknown }} */ (e);
    ausgabe = String(p.stdout || '') + String(p.stderr || '');
  }
  const jeDatei = new Map();
  for (const zeile of ausgabe.split('\n')) {
    const m = zeile.match(/^([^(]+)\(\d+,\d+\): error TS\d+/);
    if (!m) continue;
    const datei = (m[1] ?? '').replace(/\\/g, '/');
    if (!jeDatei.has(datei)) jeDatei.set(datei, []);
    jeDatei.get(datei).push(zeile);
  }
  return jeDatei;
}

/**
 * Steht `noImplicitAny` in tsconfig.json wirklich auf true?
 *
 * Gelesen als TEXT und nicht per require(): tsconfig.json trägt Kommentare
 * (JSONC), JSON.parse scheitert daran. Ein Muster reicht hier — geprüft wird
 * eine einzelne, eindeutige Zeile, nicht die Struktur der Datei.
 */
function schalterIstAn() {
  const roh = require('node:fs').readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
  const m = roh.match(/"noImplicitAny"\s*:\s*(true|false)/);
  if (!m) return { an: false, grund: 'Der Eintrag "noImplicitAny" fehlt in tsconfig.json.' };
  if (m[1] !== 'true') return { an: false, grund: 'tsconfig.json hat "noImplicitAny": false.' };
  return { an: true, grund: '' };
}

function main() {
  const schalter = schalterIstAn();
  if (!schalter.an) {
    console.error('\n❌ ' + schalter.grund + '\n');
    console.error('Der Schalter war einmal aus, und der Abbau von 454 Meldungen hat');
    console.error('ihn scharf gemacht. Ihn wieder auszuschalten macht `tsc` GRUENER —');
    console.error('genau deshalb steht diese Pruefung hier und nicht im Uebersetzer.');
    process.exit(1);
  }

  const jeDatei = meldungenJeDatei();

  const neu = [...jeDatei.keys()].filter(d => !OFFEN.has(d)).sort();
  const verwaist = [...OFFEN].filter(d => !jeDatei.has(d)).sort();

  if (neu.length) {
    console.error('\n❌ noImplicitAny: Meldungen aus Dateien, die sauber sein sollten:\n');
    for (const d of neu) {
      for (const z of jeDatei.get(d).slice(0, 5)) console.error('   ' + z);
      const rest = jeDatei.get(d).length - 5;
      if (rest > 0) console.error(`   … und ${rest} weitere in ${d}`);
    }
    console.error('\nEntweder die Typen ergänzen — oder, wenn die Datei wirklich noch');
    console.error('nicht dran ist, bewusst in OFFEN aufnehmen (scripts/check-noimplicitany.js).');
  }

  if (verwaist.length) {
    console.error('\n❌ Verwaiste Einträge in OFFEN — diese Dateien sind sauber (oder weg):\n');
    for (const d of verwaist) console.error('   ' + d);
    console.error('\nBitte aus der Liste streichen. Eine Ausnahmeliste, die nicht');
    console.error('mitschrumpft, verliert genau den Zweck, für den es sie gibt.');
  }

  const offeneMeldungen = [...jeDatei.entries()]
    .filter(([d]) => OFFEN.has(d))
    .reduce((n, [, z]) => n + z.length, 0);

  if (neu.length || verwaist.length) process.exit(1);

  if (OFFEN.size === 0) {
    console.log('✅ noImplicitAny: in tsconfig.json scharf, Ausnahmeliste leer — der ganze Baum ist sauber.');
    return;
  }
  console.log(`✅ noImplicitAny: alle Dateien ausser den ${OFFEN.size} bekannten sind sauber ` +
              `(${offeneMeldungen} Meldungen stehen dort noch offen).`);
}

main();
