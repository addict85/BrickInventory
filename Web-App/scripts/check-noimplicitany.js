#!/usr/bin/env node
/**
 * noImplicitAny — gestaffelt, mit einer Liste, die nur kürzer werden darf.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Dateien, die `noImplicitAny` noch NICHT bestehen.
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
