/** Die Kacheln der Verwaltung als Sicht auf auftraege.fortschritt (k.fortschritt()):
 * Ein zweiter Speicher konnte dem ersten widersprechen. */

import { logAndContinue } from '../infra/fehler';
import { BILDLADE_ZAEHLER } from '../katalog';
import type { AuftragsArt } from '../auftraege';
import type { ManagementContext } from './context';

type LetzterStand = Awaited<ReturnType<ManagementContext['auftraege']['letzteJeArt']>>[number];

export interface Tile {
  label: string;
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  total: number;
  sub?: string | null;
  lastRun?: string | null;
  [k: string]: unknown;
}

const TILES: Record<string, { art: AuftragsArt; label: string; total: number }> = {
  csvImport: { art: 'csv_sync', label: 'CSV-Import (Rebrickable)', total: 8 },
  instrQueue: { art: 'anleitung', label: 'Anleitungen herunterladen', total: 0 },
  priceJob: { art: 'preise', label: 'Preise aktualisieren', total: 0 },
  imgDl: { art: 'bild_nachlauf', label: '📥 Bild-Download (CDN)', total: 0 },
};
const WITHOUT_JOB: Record<string, Tile> = {
  blIds: { label: 'BrickLink IDs nachladen', status: 'idle', progress: 0, total: 0 },
  pdfJobs: { label: '📄 PDF-Jobs', status: 'idle', progress: 0, total: 0 },
  bricksetRetry: { label: '🔄 Brickset Retry Queue', status: 'done', progress: 0, total: 0 },
};

const STATUS: Record<string, Tile['status']> = {
  laeuft: 'running',
  erledigt: 'done',
  fehler: 'error',
  abgebrochen: 'idle',
  offen: 'idle',
};
const toInt = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);

function asTile(k: { label: string; total: number }, z: LetzterStand | undefined): Tile {
  if (!z) return { label: k.label, status: 'idle', progress: 0, total: k.total, sub: null, lastRun: null };
  const f = z.progress ?? {};
  return {
    label: typeof f.schritt === 'string' ? f.schritt : k.label,
    status: STATUS[z.status] ?? 'idle',
    progress: toInt(f.erledigt),
    total: toInt(f.gesamt) || k.total,
    sub: z.status === 'fehler' ? z.error_message : typeof f.text === 'string' ? f.text : null,
    lastRun: z.updated_at ? new Date(z.updated_at).toISOString() : null,
  };
}

export async function tiles(kx: ManagementContext): Promise<Record<string, Tile>> {
  const zeilen = await kx.auftraege.letzteJeArt(Object.values(TILES).map(k => k.art));
  const je = new Map(zeilen.map(z => [z.type, z]));
  const aus: Record<string, Tile> = { ...WITHOUT_JOB };
  for (const [name, k] of Object.entries(TILES)) aus[name] = asTile(k, je.get(k.art));
  const csv = je.get('csv_sync');
  if (csv?.status === 'laeuft' && csv.progress?.schritt === 'BrickLink IDs nachladen')
    aus.blIds = { ...asTile({ label: 'BrickLink IDs nachladen', total: 0 }, csv) };
  return aus;
}

export async function tile(k: ManagementContext, name: string): Promise<Tile | null> {
  return (await tiles(k))[name] ?? null;
}

export async function imgDlPending(k: ManagementContext) {
  const n = parseInt((await k.auftraege.liesZustand(BILDLADE_ZAEHLER)) || '0', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function imgDlReset(k: ManagementContext) {
  await k.auftraege.setzeZustand(BILDLADE_ZAEHLER, 0).catch(logAndContinue('job-monitor:setzeZustand'));
}
