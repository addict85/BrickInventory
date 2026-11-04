/** Der Job-Prozess schreibt nach laufzustand, der Web-Prozess liest. */

import { meldeUndWeiter, logAndContinue, meldeUndLiefere } from '../infra/httpError';
import { liesZustand, setzeZustand, zaehleZustand, zustaendeMitPraefix } from './repository/laufzustand';

const JOB_DEFAULTS: Record<string, any> = {
  csvImport:     { label: 'CSV-Import (Rebrickable)', status: 'idle', progress: 0, total: 6 },
  blIds:         { label: 'BrickLink IDs nachladen',  status: 'idle', progress: 0, total: 0 },
  instrQueue:    { label: 'Anleitungen herunterladen', status: 'idle', progress: 0, total: 0 },
  priceJob:      { label: 'Preise aktualisieren',     status: 'idle', progress: 0, total: 0 },
  imgDl:         { label: '📥 Bild-Download (CDN)',   status: 'idle', progress: 0, total: 0 },
  pdfJobs:       { label: '📄 PDF-Jobs',              status: 'idle', progress: 0, total: 0 },
  bricksetRetry: { label: '🔄 Brickset Retry Queue',  status: 'done', progress: 0, total: 0 },
};

export async function update(jobKey: string, patch: any) {
  const defaults = JOB_DEFAULTS[jobKey] || {};
  const value = JSON.stringify({ ...defaults, ...patch, lastRun: new Date().toISOString() });
  setzeZustand(`job_monitor_${jobKey}`, value).catch(e => console.error('[jobMonitor] update error:', e.message));
}

// Über ALLE Stapel beider Prozesse summiert, atomar in einer Anweisung —
// nicht job_monitor_*, damit all() ihn nicht als Job liest.
const IMGDL_PENDING_KEY = 'imgdl_pending_count';

export async function imgDlAdd(delta: number) {
  const d = Math.round(Number(delta) || 0);
  if (!d) return;
  await zaehleZustand(IMGDL_PENDING_KEY, d).catch(e => console.error('[jobMonitor] imgDlAdd error:', e.message));
  if (d > 0) {
    // Nur Marker für die Anzeige; die Zahl kommt aus dem Zähler oben.
    await update('imgDl', { status: 'running', sub: null }).catch(logAndContinue('job-monitor:update'));
  }
}

export async function imgDlPending() {
  const n = parseInt(await liesZustand(IMGDL_PENDING_KEY) || '0', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function imgDlReset() {
  await setzeZustand(IMGDL_PENDING_KEY, 0).catch(logAndContinue('job-monitor:setzeZustand'));
}

export async function get(jobKey: string) {
  const roh = await liesZustand(`job_monitor_${jobKey}`);
  if (!roh) return JOB_DEFAULTS[jobKey] || null;
  try { return JSON.parse(roh); } catch(_) { return JOB_DEFAULTS[jobKey]; }
}

export async function all() {
  const rows = await zustaendeMitPraefix('job_monitor_').catch(meldeUndLiefere('job-monitor:zustaendeMitPraefix', []));
  const result: Record<string, any> = { ...JOB_DEFAULTS };
  for (const row of rows) {
    const key = row.schluessel.replace('job_monitor_', '');
    try { result[key] = { ...(JOB_DEFAULTS[key] || {}), ...JSON.parse(row.wert) }; } catch (e) { meldeUndWeiter('job-monitor:beschaedigter-eintrag', e); }
  }
  return result;
}

