#!/usr/bin/env node
/**
 * Abdeckungs-Landkarte: Welche Module berührt kein einziger AUSGEFÜHRTER Test?
 *
 * ── Warum es das gibt (Nachtrag 152) ────────────────────────────────────────
 * Die Suite hat zwei Sorten Prüfungen. Die einen führen Code aus — echte
 * Handler, echte Datenbank, echtes jsdom. Die anderen lesen Quelltext und
 * halten Regeln fest („diese Logik steht nur an einer Stelle"). Beide haben
 * ihre Berechtigung, aber nur die erste sagt etwas darüber, ob der Code TUT,
 * was er soll.
 *
 * Aus der blossen Zahl der Tests lässt sich nicht ablesen, welche Module nur
 * von der zweiten Sorte berührt werden. Genau diese Frage beantwortet dieser
 * Bericht.
 *
 *   npm run coverage
 *
 * ── Was die Zahl NICHT ist ─────────────────────────────────────────────────
 * Keine Zielgrösse. Eine Abdeckungsquote als Ziel zu setzen führt zuverlässig
 * zu Tests, die Zeilen berühren, ohne etwas zu behaupten. Der Bericht ist eine
 * LANDKARTE: Er zeigt, wo man beim nächsten Mal hinschauen sollte. Deshalb gibt
 * es hier auch keine Schwelle und keinen Fehlschlag — das Skript endet immer
 * mit 0.
 *
 * ── Warum nicht in CI ──────────────────────────────────────────────────────
 * Der Lauf mit Abdeckungsmessung dauert spürbar länger als der normale, und
 * eine Zahl, die nichts durchfallen lässt, gehört nicht in einen Lauf, der bei
 * jedem Push blockiert. Von Hand aufgerufen, wenn man wissen will, wo die
 * weissen Flecken sind.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs   = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Alle Quelldateien, die überhaupt abgedeckt sein KÖNNTEN. */
function quellDateien() {
  const raus = ['node_modules', 'dist', '.git', 'data', 'pgdata', 'test', 'public', 'scripts'];
  const gefunden = [];
  (function lauf(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (raus.includes(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        gefunden.push(path.relative(ROOT, p).replace(/\\/g, '/'));
      }
    }
  })(ROOT);
  return gefunden.sort();
}

function main() {
  const ziel = '/tmp/brickinv-coverage.info';
  console.log('Suite mit Abdeckungsmessung — das dauert ein paar Minuten …\n');

  const r = spawnSync(process.execPath, [
    '--test', '--test-concurrency=1', '--test-timeout=60000',
    '--experimental-test-coverage',
    '--test-reporter=lcov', `--test-reporter-destination=${ziel}`,
    'test/*.test.js',
  ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'ignore', 'inherit'], shell: true });

  if (!fs.existsSync(ziel)) {
    console.error('Kein Abdeckungsbericht entstanden.');
    return;
  }

  // lcov: SF:<datei>, danach je Zeile DA:<nr>,<treffer>
  const stand = new Map();             // ts-Pfad → { gesamt, getroffen }
  /** @type {string | null} */
  let datei = null;
  for (const zeile of fs.readFileSync(ziel, 'utf8').split('\n')) {
    if (zeile.startsWith('SF:')) {
      // Die Messung sieht dist/*.js; die Frage stellt sich für die *.ts daneben.
      const roh = zeile.slice(3).trim();
      datei = /(^|\/)dist\//.test(roh)
        ? roh.replace(/^.*?dist\//, '').replace(/\.js$/, '.ts')
        : null;                        // Testdateien und Fremdcode überspringen
      if (datei && !stand.has(datei)) stand.set(datei, { gesamt: 0, getroffen: 0 });
      continue;
    }
    const m = zeile.match(/^DA:\d+,(\d+)/);
    if (!m || !datei) continue;
    const s = stand.get(datei);
    s.gesamt++;
    if (Number(m[1]) > 0) s.getroffen++;
  }

  const alle = quellDateien();
  const quote = (/** @type {string} */ f) => {
    const s = stand.get(f);
    return s && s.gesamt ? (100 * s.getroffen / s.gesamt) : 0;
  };
  const weiss = alle.filter(f => !stand.has(f) || quote(f) === 0);

  console.log('\n══ Abdeckungs-Landkarte ═══════════════════════════════════════════\n');
  console.log(`${alle.length - weiss.length} von ${alle.length} Modulen werden von mindestens einem ` +
              'ausgeführten Test berührt.\n');

  if (weiss.length) {
    console.log('Von KEINEM ausgeführten Test berührt:\n');
    for (const f of weiss) console.log('   ' + f);
    console.log('\nDas heisst nicht, dass diese Module ungeprüft sind — für viele gibt es');
    console.log('Regeln am Quelltext. Es heisst, dass niemand sie je hat LAUFEN lassen.\n');
  }

  // Die eigentliche Landkarte: WO ist wenig ausgeführt? Zwanzig reichen —
  // eine vollständige Liste liest niemand, und der lcov-Bericht hat sie ohnehin.
  const gemessen = alle.filter(f => stand.has(f)).sort((a, b) => quote(a) - quote(b));
  console.log('Am wenigsten ausgeführt (Zeilen):\n');
  for (const f of gemessen.slice(0, 20)) {
    const s = stand.get(f);
    console.log(`   ${String(quote(f).toFixed(0)).padStart(3)}%  ${String(s.getroffen).padStart(4)}/` +
                `${String(s.gesamt).padEnd(5)} ${f}`);
  }

  const gGes = gemessen.reduce((n, f) => n + stand.get(f).gesamt, 0);
  const gTrf = gemessen.reduce((n, f) => n + stand.get(f).getroffen, 0);
  console.log(`\nÜber alle gemessenen Module: ${(100 * gTrf / gGes).toFixed(1)} % der Zeilen.`);
  console.log('Vollständiger lcov-Bericht: ' + ziel);
}

main();
