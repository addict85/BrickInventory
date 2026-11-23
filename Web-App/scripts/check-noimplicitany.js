#!/usr/bin/env node
'use strict';
/**
 * noImplicitAny — staggered, with a list that may only get shorter.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Files that do NOT pass `noImplicitAny` yet.
 */
// The type is here since the list is EMPTY: `new Set([])` otherwise yields
// Set<never>, and this script fails its own check. Exactly the
// kind of place it reported everywhere else.
/** @type {Set<string>} */
const OPEN = new Set([]);

/** Run tsc with noImplicitAny and collect the messages per file. */
function messagesPerFile() {
  let output = '';
  try {
    execFileSync(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--noImplicitAny'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    // execFileSync attaches stdout/stderr to the thrown error — exactly what
    // we need here, because tsc reports its findings via the output and
    // exits with an error code in doing so. The cast names that; an
    // `unknown` could not be read otherwise, and an `any` on the
    // catch parameter would be the door again that this switch closes.
    const p = /** @type {{ stdout?: unknown, stderr?: unknown }} */ (e);
    output = String(p.stdout || '') + String(p.stderr || '');
  }
  const perFile = new Map();
  for (const row of output.split('\n')) {
    const m = row.match(/^([^(]+)\(\d+,\d+\): error TS\d+/);
    if (!m) continue;
    const file = (m[1] ?? '').replace(/\\/g, '/');
    if (!perFile.has(file)) perFile.set(file, []);
    perFile.get(file).push(row);
  }
  return perFile;
}

/**
 * Is `noImplicitAny` in tsconfig.json really set to true?
 *
 * Read as TEXT and not via require(): tsconfig.json carries comments
 * (JSONC), JSON.parse fails on them. A pattern is enough here — what is checked is
 * a single, unambiguous line, not the structure of the file.
 */
function isSwitchOn() {
  const raw = require('node:fs').readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
  const m = raw.match(/"noImplicitAny"\s*:\s*(true|false)/);
  if (!m) return { an: false, reason: 'Der Eintrag "noImplicitAny" fehlt in tsconfig.json.' };
  if (m[1] !== 'true') return { an: false, reason: 'tsconfig.json hat "noImplicitAny": false.' };
  return { an: true, reason: '' };
}

function main() {
  const flag = isSwitchOn();
  if (!flag.an) {
    console.error('\n❌ ' + flag.reason + '\n');
    console.error('Der Schalter war einmal aus, und der Abbau von 454 Meldungen hat');
    console.error('ihn scharf gemacht. Ihn wieder auszuschalten macht `tsc` GRUENER —');
    console.error('genau deshalb steht diese Pruefung hier und nicht im Uebersetzer.');
    process.exit(1);
  }

  const perFile = messagesPerFile();

  const fresh = [...perFile.keys()].filter(d => !OPEN.has(d)).sort();
  const orphaned = [...OPEN].filter(d => !perFile.has(d)).sort();

  if (fresh.length) {
    console.error('\n❌ noImplicitAny: Meldungen aus Dateien, die sauber sein sollten:\n');
    for (const d of fresh) {
      for (const z of perFile.get(d).slice(0, 5)) console.error('   ' + z);
      const rest = perFile.get(d).length - 5;
      if (rest > 0) console.error(`   … und ${rest} weitere in ${d}`);
    }
    console.error('\nEntweder die Typen ergänzen — oder, wenn die Datei wirklich noch');
    console.error('nicht dran ist, bewusst in OFFEN aufnehmen (scripts/check-noimplicitany.js).');
  }

  if (orphaned.length) {
    console.error('\n❌ Verwaiste Einträge in OFFEN — diese Dateien sind sauber (oder weg):\n');
    for (const d of orphaned) console.error('   ' + d);
    console.error('\nBitte aus der Liste streichen. Eine Ausnahmeliste, die nicht');
    console.error('mitschrumpft, verliert genau den Zweck, für den es sie gibt.');
  }

  const openMessages = [...perFile.entries()].filter(([d]) => OPEN.has(d)).reduce((n, [, z]) => n + z.length, 0);

  if (fresh.length || orphaned.length) process.exit(1);

  if (OPEN.size === 0) {
    console.log('✅ noImplicitAny: in tsconfig.json scharf, Ausnahmeliste leer — der ganze Baum ist sauber.');
    return;
  }
  console.log(
    `✅ noImplicitAny: alle Dateien ausser den ${OPEN.size} bekannten sind sauber ` +
      `(${openMessages} Meldungen stehen dort noch offen).`,
  );
}

main();
