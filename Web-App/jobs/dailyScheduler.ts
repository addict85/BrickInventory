'use strict';
/**
 * Zeitplaner für TÄGLICHE Jobs mit im Monitoring konfigurierbarer Uhrzeit (HH:MM).
 *
 * - Uhrzeiten liegen in global_settings unter `job_time_<name>` (Fallback = default).
 * - Läuft nur im Primary-Worker (dort werden die Jobs registriert).
 * - Änderungen greifen SOFORT: die API setzt ein DB-Flag `job_reschedule_trigger`,
 *   das der Primary hier alle 3s pollt und dann alles neu plant. Zusätzlich ruft
 *   die API rescheduleAll() direkt auf (falls die Anfrage auf dem Primary landet).
 */
const db = require('../db/database');

// Metadaten der täglichen Jobs. monitorKey = Schlüssel der Job-Karte im Monitoring
// (damit die UI die passende Uhrzeit dem richtigen Job zuordnen kann).
const DAILY_JOBS = [
  { name: 'brickset_retry', monitorKey: 'bricksetRetry', default: '04:00' },
  { name: 'csv_sync',       monitorKey: 'csvImport',     default: '03:00' },
];

const _registry: any = {}; // name -> { fn, timer }

/** Uhrzeit-Typ des Planers. */
type Uhrzeit = { h: number; min: number };

function _parseHHMM(s: string | null | undefined, fallback: Uhrzeit): Uhrzeit {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return fallback;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return fallback;
  return { h, min };
}

function _metaDefault(name: string) {
  const meta = DAILY_JOBS.find(j => j.name === name);
  return _parseHHMM(meta?.default, { h: 4, min: 0 });
}

// Konfigurierte Uhrzeit (HH:MM als {h,min}) für einen Job.
async function getTime(name: string) {
  const row = await db.get(`SELECT value FROM global_settings WHERE key=$1`, [`job_time_${name}`]).catch(() => null);
  return _parseHHMM(row?.value, _metaDefault(name));
}

async function _scheduleOne(name: string) {
  const job = _registry[name];
  if (!job) return;
  if (job.timer) { clearTimeout(job.timer); job.timer = null; }
  const { h, min } = await getTime(name);
  const now = new Date(), next = new Date();
  next.setHours(h, min, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next.getTime() - now.getTime();
  console.log(`[scheduler] ${name}: nächster Lauf ${next.toLocaleString('de-CH')} (in ${Math.round(ms / 3600000 * 10) / 10}h)`);
  job.timer = setTimeout(async () => {
    try { await job.fn(); } catch (e) { console.error(`[scheduler] ${name}:`, e.message); }
    _scheduleOne(name); // für den nächsten Tag neu planen
  }, ms);
}

// Job registrieren und einplanen (im Primary-Worker aufrufen).
function register(name: string, fn: () => any) {
  _registry[name] = { fn, timer: null };
  _scheduleOne(name);
}

// Alle täglichen Jobs neu planen (nach Config-Änderung) + Preis-Job (Intervall).
async function rescheduleAll() {
  for (const name of Object.keys(_registry)) await _scheduleOne(name);
  try { require('./priceJob').reschedule(); } catch (_) {}
}

// Poll für Reschedule-Signal (Config-Änderung kann auf beliebigem Worker passieren).
/**
 * Wartet auf Reschedule-Signale. Hiess früher so, weil es alle 3 Sekunden die
 * Datenbank abgefragt hat — jetzt hängt es an LISTEN/NOTIFY und meldet sich
 * nur noch, wenn tatsächlich etwas ansteht. Der Eintrag in global_settings
 * bleibt die belastbare Quelle; pgNotify ruft den Handler beim Verbinden
 * einmal von sich aus auf, damit ein verpasstes Signal nachgeholt wird.
 */
function startTriggerPoll() {
  require('../utils/pgNotify').listen('job_reschedule_trigger', async () => {
    const row = await db.get(`SELECT value FROM global_settings WHERE key='job_reschedule_trigger'`).catch(() => null);
    if (!row?.value) return;
    await db.run(`DELETE FROM global_settings WHERE key='job_reschedule_trigger'`).catch(() => {});
    console.log('[scheduler] Reschedule-Trigger empfangen — plane Jobs neu');
    await rescheduleAll();
  });
}

export { DAILY_JOBS, register, rescheduleAll, startTriggerPoll, getTime };