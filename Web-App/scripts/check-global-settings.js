#!/usr/bin/env node
/**
 * `global_settings` wird über utils/settings.ts angefasst, nicht direkt.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * NACHGEMESSEN: Die Tabelle wurde aus 22 Dateien direkt gelesen — in VIER
 * verschiedenen Schreibweisen für dasselbe (`key=`, `key=$1`, `key = $1`,
 * `SELECT key, value` über alles) — und aus neun Stellen mit je eigenem
 * INSERT geschrieben. Genau EINE davon setzte `updated_at`; in den übrigen
 * acht blieb das Feld auf dem Wert des allerersten Anlegens stehen.
 *
 * `getGlobalSetting()` gab es schon, benutzt haben es fünf Dateien.
 *
 * ── Warum eine Liste statt eines Verbots ────────────────────────────────────
 * Dasselbe Muster wie bei check-noimplicitany.js: Ein Schalter, der sofort 94
 * Meldungen erzeugt, wird nicht befolgt, sondern übergangen. Die Liste hält
 * den Bestand fest und darf nur KÜRZER werden — jede neue Stelle fällt sofort
 * auf, und der Bestand lässt sich in Ruhe abbauen.
 *
 * ── Was NICHT auf die Liste gehört ──────────────────────────────────────────
 * db/database.ts (legt die Tabelle an) und jobs/csvImportWorker.ts (eigener
 * Prozess mit eigenem Verbindungspool, kann utils/ nicht laden) sind
 * dauerhafte Ausnahmen und stehen deshalb unten separat.
 *
 * Stand messen:  node scripts/check-global-settings.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Dauerhaft erlaubt, mit Grund. */
const ERLAUBT = new Map([
  ['db/database.ts', 'legt die Tabelle an und migriert sie'],
  ['jobs/csvImportWorker.ts', 'eigener Prozess mit eigenem Pool — kann utils/ nicht laden'],
  ['utils/settings.ts', 'DIE zentrale Stelle'],
]);

/**
 * Der Bestand beim Einführen dieser Prüfung. Diese Zahlen dürfen nur SINKEN.
 * Wer eine Datei leerräumt, streicht ihre Zeile.
 */
const OFFEN = new Map([
  ['jobs/backfillBlPartNumbers.ts', 1],
  ['jobs/dailyScheduler.ts', 5],
  ['jobs/imageQueue.ts', 3],
  ['jobs/instructionQueue.ts', 7],
  ['jobs/partsCatalogEnrich.ts', 2],
  ['jobs/priceJob.ts', 2],
  ['jobs/rebrickableCsvSync.ts', 8],
  ['routes/api_v1/admin.ts', 15],
  ['routes/api_v1/settings.ts', 1],
  ['routes/auth.ts', 1],
  ['routes/mailer.ts', 2],
  ['routes/settings.ts', 11],
  ['server.ts', 8],
  ['utils/bricklinkLink.ts', 1],
  ['utils/financeCalc.ts', 8],
  ['utils/handlers/stats.ts', 1],
  ['utils/indexHtml.ts', 1],
  ['utils/jobMonitor.ts', 7],
  ['utils/marketPrice.ts', 1],
  ['utils/pgNotify.ts', 3],
  ['utils/rateLimiter.ts', 3],
  ['utils/setService.ts', 1],
]);

function dateien() {
  const out = [];
  /** @param {string} d */
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name.endsWith('.ts')) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  for (const d of ['routes', 'utils', 'jobs', 'db', 'startup']) {
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
    fehler.push(`NEU: ${datei} (${n}x). global_settings gehört über utils/settings.ts — ` +
      `getGlobalSetting() / setGlobalSetting(). Nur so ist updated_at einheitlich ` +
      `und ein späterer Umbau der Tabelle EINE Änderung statt zwanzig.`);
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
