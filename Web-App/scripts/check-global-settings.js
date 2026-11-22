#!/usr/bin/env node
/**
 * `global_settings` is touched via src/settings/settings.ts, not directly.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Permanently allowed, with a reason. */
const ALLOWED = new Map([
  ['db/schemaStart.ts', 'legt die Tabelle an und migriert sie'],
  ['db/rows.ts', 'erzeugte Zeilentypen aller Tabellen, kein Zugriff'],
  ['jobs/csvImportWorker.ts', 'eigener Prozess mit eigenem Pool, ohne den Datenbankzugang des Servers'],
  ['src/settings/settings.ts', 'DIE zentrale Stelle'],
  ['src/settings/repository/values.ts', 'das SQL hinter settings.ts — nur dort aufgerufen'],
]);

/**
 * The remaining stock. These numbers may only DECREASE.
 * Whoever clears a file removes its line.
 */
const OPEN = new Map([]);

function files() {
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

const found = new Map();
for (const rel of files()) {
  if (ALLOWED.has(rel)) continue;
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const n = (s.match(/global_settings/g) || []).length;
  if (n) found.set(rel, n);
}

const fehler = [];
for (const [file, n] of found) {
  const allowed = OPEN.get(file);
  if (allowed === undefined) {
    fehler.push(
      `NEU: ${file} (${n}x). global_settings gehört über src/settings/settings.ts — ` +
        `getGlobalSetting() / setGlobalSetting(). Nur so ist updated_at einheitlich ` +
        `und ein späterer Umbau der Tabelle EINE Änderung statt zwanzig.`,
    );
  } else if (n > allowed) {
    fehler.push(`MEHR: ${file} hat ${n} statt ${allowed}. Die Liste darf nur kürzer werden.`);
  }
}
// A line nobody needs any more is a permission nobody checks.
for (const [file, n] of OPEN) {
  const actual = found.get(file) ?? 0;
  if (actual === 0) fehler.push(`ERLEDIGT: ${file} — Zeile aus OFFEN streichen.`);
  else if (actual < n) fehler.push(`GESUNKEN: ${file} hat ${actual} statt ${n} — Zahl in OFFEN nachziehen.`);
}

if (fehler.length) {
  console.error('❌ global_settings:\n  ' + fehler.join('\n  '));
  process.exit(1);
}
const sum = [...found.values()].reduce((a, b) => a + b, 0);
console.log(`✅ global_settings: ${found.size} Dateien / ${sum} Stellen offen, keine neue.`);
