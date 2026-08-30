/**
 * Central job monitoring — stores status in PostgreSQL so all cluster workers share state.
 * UI polls GET /api/v1/admin/jobs to display progress.
 */

import * as db from '../db/database';
import { meldeUndWeiter } from './httpError';

const JOB_DEFAULTS: Record<string, any> = {
  csvImport:     { label: 'CSV-Import (Rebrickable)', status: 'idle', progress: 0, total: 6 },
  blIds:         { label: 'BrickLink IDs nachladen',  status: 'idle', progress: 0, total: 0 },
  instrQueue:    { label: 'Handbücher herunterladen', status: 'idle', progress: 0, total: 0 },
  priceJob:      { label: 'Preise aktualisieren',     status: 'idle', progress: 0, total: 0 },
  imgDl:         { label: '📥 Bild-Download (CDN)',   status: 'idle', progress: 0, total: 0 },
  pdfJobs:       { label: '📄 PDF-Jobs',              status: 'idle', progress: 0, total: 0 },
  bricksetRetry: { label: '🔄 Brickset Retry Queue',  status: 'done', progress: 0, total: 0 },
};

async function update(jobKey: string, patch: any) {
  const defaults = JOB_DEFAULTS[jobKey] || {};
  const value = JSON.stringify({ ...defaults, ...patch, lastRun: new Date().toISOString() });
  await db.run(
    `INSERT INTO global_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [`job_monitor_${jobKey}`, value]
  ).catch(e => console.error('[jobMonitor] update error:', e.message));
}

// ── Bild-Download-Zähler ──────────────────────────────────────────────────
// Über ALLE aktiven downloadSetImages-Batches UND Cluster-Worker summierte
// Zahl der noch zu ladenden Bilder. Eigener Bare-Integer-Eintrag (bewusst NICHT
// job_monitor_*, damit all() ihn nicht als Job parst). Die Arithmetik läuft
// atomar in EINEM UPDATE — der Row-Lock serialisiert gleichzeitige Batches.
// Früher überschrieb jeder Batch den imgDl-Status (last-write-wins), sodass im
// Monitoring nur der zuletzt gestartete Wert statt der Summe erschien.
const IMGDL_PENDING_KEY = 'imgdl_pending_count';

async function imgDlAdd(delta: number) {
  const d = Math.round(Number(delta) || 0);
  if (!d) return;
  await db.run(
    `INSERT INTO global_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE
       SET value = GREATEST(0, COALESCE(NULLIF(global_settings.value, '')::int, 0) + $3)::text`,
    [IMGDL_PENDING_KEY, String(Math.max(0, d)), d]
  ).catch(e => console.error('[jobMonitor] imgDlAdd error:', e.message));
  if (d > 0) {
    // Nur lastRun-/Label-Marker für die Anzeige — die Zahl kommt aus dem
    // Zähler oben, nicht aus diesem Feld.
    await update('imgDl', { status: 'running', sub: null }).catch(() => {});
  }
}

async function imgDlPending() {
  const row = await db.get(
    `SELECT value FROM global_settings WHERE key = $1`, [IMGDL_PENDING_KEY]
  ).catch(() => null);
  const n = parseInt(row?.value || '0', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

async function imgDlReset() {
  await db.run(
    `UPDATE global_settings SET value = '0' WHERE key = $1`, [IMGDL_PENDING_KEY]
  ).catch(() => {});
}

async function get(jobKey: string) {
  const row = await db.get(
    `SELECT value FROM global_settings WHERE key = $1`,
    [`job_monitor_${jobKey}`]
  ).catch(() => null);
  if (!row) return JOB_DEFAULTS[jobKey] || null;
  try { return JSON.parse(row.value); } catch(_) { return JOB_DEFAULTS[jobKey]; }
}

async function all() {
  const rows = await db.all(
    `SELECT key, value FROM global_settings WHERE key LIKE 'job_monitor_%'`
  ).catch(() => []);
  const result: Record<string, any> = { ...JOB_DEFAULTS };
  for (const row of rows) {
    const key = row.key.replace('job_monitor_', '');
    try { result[key] = { ...(JOB_DEFAULTS[key] || {}), ...JSON.parse(row.value) }; } catch (e) { meldeUndWeiter('job-monitor:beschaedigter-eintrag', e); }
  }
  return result;
}

export { update, get, all, imgDlAdd, imgDlPending, imgDlReset };
