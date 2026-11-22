import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PDF_JOB_DIR } from '../../infra/appPaths';
import { reportError, withoutMissingFile } from '../../infra/error';
import { DomainError, failDomain, notFound } from '../../infra/errorTexts';
import type { PayloadInput } from '../../jobQueue';
import { withVersion } from '../../infra/setNumber';
import type { CatalogContext } from '../context';

/** Every status change wakes the status streams (atJobStatus) with this key. */
export const pdfKey = (id: string) => `pdf:${id}`;

/** The identifier becomes the file name, so everything else is rejected. The old
 * form stays valid so that jobs remain retrievable across an update. */
const JOB_ID_RE = /^\d{10,16}-[a-z0-9]{4,12}$/;
export function validJobId(id: string): boolean {
  return JOB_ID_RE.test(id);
}

export function pdfFilePath(id: string): string | null {
  return validJobId(id) ? path.join(PDF_JOB_DIR, `${id}.pdf`) : null;
}

export type PdfJob = {
  status: 'running' | 'done' | 'error';
  error: string | null;
  user_id: number;
  missingImages?: number | null;
  etaSeconds?: number | null;
};

const STATUS: Record<string, PdfJob['status']> = { open: 'running', running: 'running', done: 'done' };

/** Under row security and filtered by account: a foreign job is no job. */
export async function readJob(k: CatalogContext, id: string, uid: number): Promise<PdfJob | null> {
  const z = await k.jobQueue.ownJob('pdf', pdfKey(id), uid);
  const { fehlendeBilder, etaSekunden } = z?.progress ?? {};
  return z
    ? {
        status: STATUS[z.status] ?? 'error',
        error: z.status === 'done' ? null : (z.error_message ?? null),
        user_id: Number(z.user_id),
        missingImages: typeof fehlendeBilder === 'number' ? fehlendeBilder : null,
        etaSeconds: typeof etaSekunden === 'number' ? etaSekunden : null,
      }
    : null;
}

/** `status` shows the UI how far a not-yet-finished job has progressed. */
export async function finishedFile(k: CatalogContext, id: string, uid: number): Promise<string> {
  const job = await readJob(k, id, uid);
  if (!job) notFound('job_not_found');
  if (job.status !== 'done') throw new DomainError('konflikt', 'pdf_not_ready', undefined, { status: job.status });
  const file = pdfFilePath(id);
  if (!file || !fs.existsSync(file)) failDomain('nicht_mehr_da', 'pdf_not_available');
  return file;
}

export async function deleteJob(k: CatalogContext, id: string, uid: number): Promise<void> {
  await k.jobQueue.deleteOwn('pdf', pdfKey(id), uid);
}

export const PDF_JOB_TTL = 10 * 60 * 1000;
/** Per user: one job loads hundreds of images. */
export const MAX_JOBS_PRO_USER = 2;

/** Not guessable, but sortable. */
export function newJobId(now: number): string {
  return `${now}-${crypto.randomBytes(6).toString('hex')}`;
}

export async function cleanOldPdfJobs(k: CatalogContext) {
  for (const key of await k.jobQueue.deleteEnded('pdf', PDF_JOB_TTL / 1000)) {
    const file = pdfFilePath(key.slice('pdf:'.length));
    if (file) await fsp.unlink(file).catch(withoutMissingFile('pdf:datei loeschen'));
  }
  const files = await fsp.readdir(PDF_JOB_DIR).catch((e: unknown) => {
    withoutMissingFile('pdf:ordner lesen')(e);
    return [] as string[];
  });
  for (const f of files) {
    const fp = path.join(PDF_JOB_DIR, f);
    const st = await fsp.stat(fp).catch(withoutMissingFile('pdf:datei pruefen'));
    if (st && k.clock.now() - st.mtimeMs > PDF_JOB_TTL)
      await fsp.unlink(fp).catch(withoutMissingFile('pdf:datei loeschen'));
  }
}

/** The waiting time depends on this (about one image per second). */
async function fehlendeBilder(
  k: CatalogContext,
  sets: Array<{ set_number?: unknown }>,
  parts: Array<{ image_local?: string | null | undefined; image_url?: string | null | undefined }>,
) {
  let absent = parts.filter(p => !p.image_local && p.image_url).length;
  const numbers = new Set<string>();
  for (const s of sets || []) {
    const raw = String(s?.set_number || '').trim();
    if (!raw) continue;
    numbers.add(withVersion(raw));
  }
  if (!numbers.size) return absent;
  try {
    const r = await k.imageState.missingCatalogImages([...numbers]);
    const c = Number(r?.c);
    if (Number.isFinite(c)) absent = c;
  } catch (e) {
    reportError('pdf:wartezeit schaetzen', e);
  }
  return absent;
}

/** If MAX_JOBS_PRO_USER are already running, there is no identifier but their count. */
export async function startPdfJob(
  k: CatalogContext,
  uid: number,
  sets: PayloadInput<'pdf'>['sets'],
  parts: PayloadInput<'pdf'>['parts'],
): Promise<{ jobId: string } | { laufend: number }> {
  const laufend = await k.jobQueue.countRunning('pdf', uid, PDF_JOB_TTL / 1000);
  if (laufend >= MAX_JOBS_PRO_USER) return { laufend };
  const jobId = newJobId(k.clock.now());
  // The client's image details do not go into the job: the images come from the catalog.
  const withoutImages = parts.map(p => ({ ...p, image_url: undefined, image_local: undefined }));
  const missingImages = await fehlendeBilder(k, sets, parts);
  await k.jobQueue.placeJobOne(
    'pdf',
    { job_id: jobId, user_id: uid, sets, parts: withoutImages },
    {
      userId: uid,
      maxAttempts: 2,
      schluessel: pdfKey(jobId),
      fortschritt: { fehlendeBilder: missingImages, etaSekunden: Math.max(3, Math.round(missingImages) + 3) },
    },
  );
  return { jobId };
}
