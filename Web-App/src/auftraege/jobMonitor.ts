/** Die Kacheln der Verwaltung als Sicht auf auftraege.fortschritt (k.fortschritt()):
 * Ein zweiter Speicher konnte dem ersten widersprechen. */

import { logAndContinue } from '../infra/fehler';
import { liesZustand, setzeZustand, zaehleZustand } from './repository/laufzustand';
import { letzteJeArt, type LetzterStand } from './repository/auftraege';
import type { AuftragsArt } from './auftraege';

export interface Kachel {
  label: string; status: 'idle' | 'running' | 'done' | 'error'; progress: number; total: number;
  sub?: string | null; lastRun?: string | null; [k: string]: unknown;
}

const KACHELN: Record<string, { art: AuftragsArt; label: string; total: number }> = {
  csvImport:  { art: 'csv_sync',      label: 'CSV-Import (Rebrickable)',  total: 8 },
  instrQueue: { art: 'anleitung',     label: 'Anleitungen herunterladen', total: 0 },
  priceJob:   { art: 'preise',        label: 'Preise aktualisieren',      total: 0 },
  imgDl:      { art: 'bild_nachlauf', label: '📥 Bild-Download (CDN)',    total: 0 },
};
const OHNE_AUFTRAG: Record<string, Kachel> = {
  blIds:         { label: 'BrickLink IDs nachladen',  status: 'idle', progress: 0, total: 0 },
  pdfJobs:       { label: '📄 PDF-Jobs',              status: 'idle', progress: 0, total: 0 },
  bricksetRetry: { label: '🔄 Brickset Retry Queue',  status: 'done', progress: 0, total: 0 },
};

const STATUS: Record<string, Kachel['status']> = { laeuft: 'running', erledigt: 'done', fehler: 'error', abgebrochen: 'idle', offen: 'idle' };
const ganz = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);

function alsKachel(k: { label: string; total: number }, z: LetzterStand | undefined): Kachel {
  if (!z) return { label: k.label, status: 'idle', progress: 0, total: k.total, sub: null, lastRun: null };
  const f = z.fortschritt ?? {};
  return {
    label: typeof f.schritt === 'string' ? f.schritt : k.label,
    status: STATUS[z.status] ?? 'idle',
    progress: ganz(f.erledigt), total: ganz(f.gesamt) || k.total,
    sub: z.status === 'fehler' ? z.fehler : (typeof f.text === 'string' ? f.text : null),
    lastRun: z.aktualisiert ? new Date(z.aktualisiert).toISOString() : null,
  };
}

export async function all(): Promise<Record<string, Kachel>> {
  const zeilen = await letzteJeArt(Object.values(KACHELN).map(k => k.art));
  const je = new Map(zeilen.map(z => [z.art, z]));
  const aus: Record<string, Kachel> = { ...OHNE_AUFTRAG };
  for (const [name, k] of Object.entries(KACHELN)) aus[name] = alsKachel(k, je.get(k.art));
  const csv = je.get('csv_sync');
  if (csv?.status === 'laeuft' && csv.fortschritt?.schritt === 'BrickLink IDs nachladen')
    aus.blIds = { ...alsKachel({ label: 'BrickLink IDs nachladen', total: 0 }, csv) };
  return aus;
}

export async function get(name: string): Promise<Kachel | null> {
  return (await all())[name] ?? null;
}

// Über ALLE Stapel beider Prozesse summiert, atomar in einer Anweisung.
const IMGDL_PENDING_KEY = 'imgdl_pending_count';

export async function imgDlAdd(delta: number) {
  const d = Math.round(Number(delta) || 0);
  if (!d) return;
  await zaehleZustand(IMGDL_PENDING_KEY, d).catch(logAndContinue('job-monitor:imgDlAdd'));
}

export async function imgDlPending() {
  const n = parseInt(await liesZustand(IMGDL_PENDING_KEY) || '0', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function imgDlReset() {
  await setzeZustand(IMGDL_PENDING_KEY, 0).catch(logAndContinue('job-monitor:setzeZustand'));
}
