/** Die Kacheln der Verwaltung als Sicht auf auftraege.fortschritt (k.fortschritt()):
 * Ein zweiter Speicher konnte dem ersten widersprechen. */

import { logAndContinue } from '../infra/fehler';
import { BILDLADE_ZAEHLER } from '../katalog';
import type { AuftragsArt } from '../auftraege';
import type { VerwaltungKontext } from './kontext';

type LetzterStand = Awaited<ReturnType<VerwaltungKontext['auftraege']['letzteJeArt']>>[number];

export interface Kachel {
  label: string;
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  total: number;
  sub?: string | null;
  lastRun?: string | null;
  [k: string]: unknown;
}

const KACHELN: Record<string, { art: AuftragsArt; label: string; total: number }> = {
  csvImport: { art: 'csv_sync', label: 'CSV-Import (Rebrickable)', total: 8 },
  instrQueue: { art: 'anleitung', label: 'Anleitungen herunterladen', total: 0 },
  priceJob: { art: 'preise', label: 'Preise aktualisieren', total: 0 },
  imgDl: { art: 'bild_nachlauf', label: '📥 Bild-Download (CDN)', total: 0 },
};
const OHNE_AUFTRAG: Record<string, Kachel> = {
  blIds: { label: 'BrickLink IDs nachladen', status: 'idle', progress: 0, total: 0 },
  pdfJobs: { label: '📄 PDF-Jobs', status: 'idle', progress: 0, total: 0 },
  bricksetRetry: { label: '🔄 Brickset Retry Queue', status: 'done', progress: 0, total: 0 },
};

const STATUS: Record<string, Kachel['status']> = {
  laeuft: 'running',
  erledigt: 'done',
  fehler: 'error',
  abgebrochen: 'idle',
  offen: 'idle',
};
const ganz = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);

function alsKachel(k: { label: string; total: number }, z: LetzterStand | undefined): Kachel {
  if (!z) return { label: k.label, status: 'idle', progress: 0, total: k.total, sub: null, lastRun: null };
  const f = z.progress ?? {};
  return {
    label: typeof f.schritt === 'string' ? f.schritt : k.label,
    status: STATUS[z.status] ?? 'idle',
    progress: ganz(f.erledigt),
    total: ganz(f.gesamt) || k.total,
    sub: z.status === 'fehler' ? z.error_message : typeof f.text === 'string' ? f.text : null,
    lastRun: z.updated_at ? new Date(z.updated_at).toISOString() : null,
  };
}

export async function kacheln(kx: VerwaltungKontext): Promise<Record<string, Kachel>> {
  const zeilen = await kx.auftraege.letzteJeArt(Object.values(KACHELN).map(k => k.art));
  const je = new Map(zeilen.map(z => [z.type, z]));
  const aus: Record<string, Kachel> = { ...OHNE_AUFTRAG };
  for (const [name, k] of Object.entries(KACHELN)) aus[name] = alsKachel(k, je.get(k.art));
  const csv = je.get('csv_sync');
  if (csv?.status === 'laeuft' && csv.progress?.schritt === 'BrickLink IDs nachladen')
    aus.blIds = { ...alsKachel({ label: 'BrickLink IDs nachladen', total: 0 }, csv) };
  return aus;
}

export async function kachel(k: VerwaltungKontext, name: string): Promise<Kachel | null> {
  return (await kacheln(k))[name] ?? null;
}

export async function imgDlPending(k: VerwaltungKontext) {
  const n = parseInt((await k.auftraege.liesZustand(BILDLADE_ZAEHLER)) || '0', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function imgDlReset(k: VerwaltungKontext) {
  await k.auftraege.setzeZustand(BILDLADE_ZAEHLER, 0).catch(logAndContinue('job-monitor:setzeZustand'));
}
