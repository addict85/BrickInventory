#!/usr/bin/env node
/**
 * `global_settings` wird über src/einstellungen/settings.ts angefasst, nicht direkt.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Dauerhaft erlaubt, mit Grund. */
const ERLAUBT = new Map([
  ['db/schemaStart.ts', 'legt die Tabelle an und migriert sie'],
  ['jobs/csvImportWorker.ts', 'eigener Prozess mit eigenem Pool, ohne den Datenbankzugang des Servers'],
  ['src/einstellungen/settings.ts', 'DIE zentrale Stelle'],
  ['src/einstellungen/repository.ts', 'das SQL hinter settings.ts — nur dort aufgerufen'],
]);

/**
 * Der Rest-Bestand. Diese Zahlen duerfen nur SINKEN.
 * Wer eine Datei leerraeumt, streicht ihre Zeile.
 */
const OFFEN = new Map([]);

function dateien() {
  const out = [];
  /** @param {string} d */
  const lauf = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name.endsWith('.ts')) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  for (const d of ['routes', 'src', 'jobs', 'db', 'startup']) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) lauf(abs);
  }
  const server = path.join(ROOT, 'server.ts');
  if (fs.existsSync(server)) out.push('server.ts');
  return out;
}

const gefunden = new Map();
for (const rel of dateien()) {
  if (ERLAUBT.has(rel)) continue;
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const n = (s.match(/global_settings/g) || []).length;
  if (n) gefunden.set(rel, n);
}

const fehler = [];
for (const [datei, n] of gefunden) {
  const erlaubt = OFFEN.get(datei);
  if (erlaubt === undefined) {
    fehler.push(
      `NEU: ${datei} (${n}x). global_settings gehört über src/einstellungen/settings.ts — ` +
        `getGlobalSetting() / setGlobalSetting(). Nur so ist updated_at einheitlich ` +
        `und ein späterer Umbau der Tabelle EINE Änderung statt zwanzig.`,
    );
  } else if (n > erlaubt) {
    fehler.push(`MEHR: ${datei} hat ${n} statt ${erlaubt}. Die Liste darf nur kürzer werden.`);
  }
}
// Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand prüft.
for (const [datei, n] of OFFEN) {
  const ist = gefunden.get(datei) ?? 0;
  if (ist === 0) fehler.push(`ERLEDIGT: ${datei} — Zeile aus OFFEN streichen.`);
  else if (ist < n) fehler.push(`GESUNKEN: ${datei} hat ${ist} statt ${n} — Zahl in OFFEN nachziehen.`);
}

if (fehler.length) {
  console.error('❌ global_settings:\n  ' + fehler.join('\n  '));
  process.exit(1);
}
const summe = [...gefunden.values()].reduce((a, b) => a + b, 0);
console.log(`✅ global_settings: ${gefunden.size} Dateien / ${summe} Stellen offen, keine neue.`);
