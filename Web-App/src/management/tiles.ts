/** The admin's tiles as a view on auftraege.fortschritt (k.fortschritt()):
 * a second store could contradict the first. */

import { logAndContinue } from '../infra/error';
import { IMAGE_LOAD_COUNTER } from '../catalog';
import type { JobKind } from '../jobQueue';
import type { ManagementContext } from './context';

type LastStatus = Awaited<ReturnType<ManagementContext['jobQueue']['lastPerKind']>>[number];

export interface Tile {
  label: string;
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  total: number;
  sub?: string | null;
  lastRun?: string | null;
  [k: string]: unknown;
}

const TILES: Record<string, { kind: JobKind; label: string; total: number }> = {
  csvImport: { kind: 'csv_sync', label: 'CSV-Import (Rebrickable)', total: 8 },
  instrQueue: { kind: 'instructions', label: 'Anleitungen herunterladen', total: 0 },
  priceJob: { kind: 'prices', label: 'Preise aktualisieren', total: 0 },
  imgDl: { kind: 'image_followup', label: '📥 Bild-Download (CDN)', total: 0 },
};
const WITHOUT_JOB: Record<string, Tile> = {
  blIds: { label: 'BrickLink IDs nachladen', status: 'idle', progress: 0, total: 0 },
  pdfJobs: { label: '📄 PDF-Jobs', status: 'idle', progress: 0, total: 0 },
  bricksetRetry: { label: '🔄 Brickset Retry Queue', status: 'done', progress: 0, total: 0 },
};

const STATUS: Record<string, Tile['status']> = {
  running: 'running',
  done: 'done',
  error: 'error',
  cancelled: 'idle',
  pending: 'idle',
};
const toInt = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);

function asTile(k: { label: string; total: number }, z: LastStatus | undefined): Tile {
  if (!z) return { label: k.label, status: 'idle', progress: 0, total: k.total, sub: null, lastRun: null };
  const f = z.progress ?? {};
  return {
    label: typeof f.schritt === 'string' ? f.schritt : k.label,
    status: STATUS[z.status] ?? 'idle',
    progress: toInt(f.done),
    total: toInt(f.total) || k.total,
    sub: z.status === 'error' ? z.error_message : typeof f.text === 'string' ? f.text : null,
    lastRun: z.updated_at ? new Date(z.updated_at).toISOString() : null,
  };
}

export async function tiles(kx: ManagementContext): Promise<Record<string, Tile>> {
  const rows = await kx.jobQueue.lastPerKind(Object.values(TILES).map(k => k.kind));
  const je = new Map(rows.map(z => [z.type, z]));
  const from: Record<string, Tile> = { ...WITHOUT_JOB };
  for (const [name, k] of Object.entries(TILES)) from[name] = asTile(k, je.get(k.kind));
  const csv = je.get('csv_sync');
  if (csv?.status === 'running' && csv.progress?.schritt === 'BrickLink IDs nachladen')
    from.blIds = { ...asTile({ label: 'BrickLink IDs nachladen', total: 0 }, csv) };
  return from;
}

export async function tile(k: ManagementContext, name: string): Promise<Tile | null> {
  return (await tiles(k))[name] ?? null;
}

export async function imgDlPending(k: ManagementContext) {
  const n = parseInt((await k.jobQueue.readState(IMAGE_LOAD_COUNTER)) || '0', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export async function imgDlReset(k: ManagementContext) {
  await k.jobQueue.setState(IMAGE_LOAD_COUNTER, 0).catch(logAndContinue('job-monitor:setzeZustand'));
}
