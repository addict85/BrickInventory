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
 * ── Die Richtung ist der Punkt ─────────────────────────────────────────────
 * Die Liste ist eine AUSNAHMELISTE, keine Auswahlliste. Eine neue Datei ist
 * automatisch streng; Schuld lässt sich nur abbauen, nicht mehr stillschweigend
 * anhäufen. Beim Aufräumen einer Datei fällt ihre Zeile hier weg, sonst nichts.
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
 * Diese Etappe: noch 11 offen. Anfragestrecke, Geldrechnung, Set-Kernlogik,
 * die PDF-Ausgabe und ALLE DREI Fremd-Klienten sind sauber.
 */
const OFFEN = new Set([
  'jobs/csvImportWorker.ts',
  'jobs/partsCatalogEnrich.ts',
  'jobs/priceJob.ts',
  'jobs/rebrickableCsvSync.ts',
  'routes/sets.ts',
  'scripts/check-api-contract.js',
  'scripts/loadtest.js',
  'utils/csvExport.ts',
  'utils/instructions.ts',
  'utils/partsImport.ts',
  'utils/portfolioHistory.ts',
]);

/** tsc mit noImplicitAny laufen lassen und die Meldungen je Datei sammeln. */
function meldungenJeDatei() {
  let ausgabe = '';
  try {
    execFileSync(process.execPath,
      [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--noImplicitAny'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    ausgabe = String(e.stdout || '') + String(e.stderr || '');
  }
  const jeDatei = new Map();
  for (const zeile of ausgabe.split('\n')) {
    const m = zeile.match(/^([^(]+)\(\d+,\d+\): error TS\d+/);
    if (!m) continue;
    const datei = m[1].replace(/\\/g, '/');
    if (!jeDatei.has(datei)) jeDatei.set(datei, []);
    jeDatei.get(datei).push(zeile);
  }
  return jeDatei;
}

function main() {
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

  console.log(`✅ noImplicitAny: alle Dateien ausser den ${OFFEN.size} bekannten sind sauber ` +
              `(${offeneMeldungen} Meldungen stehen dort noch offen).`);
}

main();
