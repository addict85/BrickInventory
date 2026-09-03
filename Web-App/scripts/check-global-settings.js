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
 * Der Rest-Bestand. Diese Zahlen duerfen nur SINKEN.
 * Wer eine Datei leerraeumt, streicht ihre Zeile.
 *
 * Beim Einfuehren der Pruefung standen hier 22 Dateien mit 92 Fundstellen. Was
 * jetzt noch uebrig ist, ist ueberwiegend KEIN einfacher Schluesselzugriff mehr:
 *   - utils/financeCalc.ts: Der Kontingentzaehler laeuft in einer Transaktion
 *     mit SELECT ... FOR UPDATE. Ein Helfer mit eigener Verbindung wuerde
 *     gerade die Sperre aufgeben, fuer die es die Transaktion gibt.
 *   - utils/jobMonitor.ts: ein atomares UPDATE mit GREATEST/COALESCE und eine
 *     LIKE-Abfrage ueber alle job_monitor_*-Schluessel.
 *   - routes/settings.ts: liest die Tabelle als GANZES fuer den
 *     Konfigurations-Export — das ist kein Zugriff auf einen einzelnen
 *     Schluessel. Die Einstellungsseite stand hier bis zur Zusammenlegung der
 *     API-Oberflaechen ebenfalls; sie liest jetzt ueber readSettings().
 *   - utils/setService.ts: liest ueber den uebergebenen Verbindungs-Handle,
 *     damit der Wert innerhalb DERSELBEN Transaktion gesehen wird.
 *   - Der Rest sind Erwaehnungen in Kommentaren. Die zaehlt die Pruefung mit,
 *     weil sie nur nach dem Tabellennamen sucht — Absicht: lieber eine Zahl zu
 *     hoch als eine echte Fundstelle uebersehen.
 */
const OFFEN = new Map([
  ['jobs/dailyScheduler.ts', 2],
  ['jobs/imageQueue.ts', 2],
  ['jobs/instructionQueue.ts', 1],
  ['jobs/partsCatalogEnrich.ts', 1],
  ['jobs/priceJob.ts', 1],
  ['routes/api_v1/admin.ts', 3],
  ['routes/mailer.ts', 1],
  ['routes/settings.ts', 1],
  ['server.ts', 1],
  ['utils/financeCalc.ts', 5],
  ['utils/jobMonitor.ts', 3],
  ['utils/pgNotify.ts', 3],
  ['utils/rateLimiter.ts', 1],
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
