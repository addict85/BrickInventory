import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { PDF_JOB_DIR } from '../../infra/appPaths';
import { reportError, withoutMissingFile } from '../../infra/fehler';
import { Fachfehler, fachfehler, notFound } from '../../infra/fehlerTexte';
import type { PayloadInput } from '../../auftraege';
import { withVersion } from '../../infra/setNummer';
import type { CatalogContext } from '../context';

/** Jeder Statuswechsel weckt die Statusströme (atJobStatus) mit diesem Schlüssel. */
export const pdfKey = (id: string) => `pdf:${id}`;

/** Die Kennung wird zum Dateinamen, darum alles andere abgewiesen. Die alte
 * Form bleibt gültig, damit Aufträge über ein Update abrufbar bleiben. */
const JOB_ID_RE = /^\d{10,16}-[a-z0-9]{4,12}$/;
export function validJobId(id: string): boolean {
  return JOB_ID_RE.test(id);
}

export function pdfFilePath(id: string): string | null {
  return validJobId(id) ? path.join(PDF_JOB_DIR, `${id}.pdf`) : null;
}

export type PdfAuftrag = {
  status: 'running' | 'done' | 'error';
  error: string | null;
  user_id: number;
  missingImages?: number | null;
  etaSeconds?: number | null;
};

const STATUS: Record<string, PdfAuftrag['status']> = { offen: 'running', laeuft: 'running', erledigt: 'done' };

/** Unter Zeilenschutz und nach Konto gefiltert: Ein fremder Auftrag ist keiner. */
export async function readJob(k: CatalogContext, id: string, uid: number): Promise<PdfAuftrag | null> {
  const z = await k.auftraege.ownJob('pdf', pdfKey(id), uid);
  const { fehlendeBilder, etaSekunden } = z?.progress ?? {};
  return z
    ? {
        status: STATUS[z.status] ?? 'error',
        error: z.status === 'erledigt' ? null : (z.error_message ?? null),
        user_id: Number(z.user_id),
        missingImages: typeof fehlendeBilder === 'number' ? fehlendeBilder : null,
        etaSeconds: typeof etaSekunden === 'number' ? etaSekunden : null,
      }
    : null;
}

/** `status` zeigt der Oberfläche, wie weit ein noch nicht fertiger Auftrag ist. */
export async function finishedFile(k: CatalogContext, id: string, uid: number): Promise<string> {
  const job = await readJob(k, id, uid);
  if (!job) notFound('job_nicht_gefunden');
  if (job.status !== 'done') throw new Fachfehler('konflikt', 'pdf_nicht_fertig', undefined, { status: job.status });
  const datei = pdfFilePath(id);
  if (!datei || !fs.existsSync(datei)) fachfehler('nicht_mehr_da', 'pdf_nicht_verfuegbar');
  return datei;
}

export async function deleteJob(k: CatalogContext, id: string, uid: number): Promise<void> {
  await k.auftraege.deleteOwn('pdf', pdfKey(id), uid);
}

export const PDF_JOB_TTL = 10 * 60 * 1000;
/** Je Benutzer: Ein Auftrag lädt hunderte Bilder nach. */
export const MAX_JOBS_PRO_USER = 2;

/** Nicht erratbar, aber sortierbar. */
export function newJobId(jetzt: number): string {
  return `${jetzt}-${crypto.randomBytes(6).toString('hex')}`;
}

export async function cleanOldPdfJobs(k: CatalogContext) {
  for (const schluessel of await k.auftraege.deleteEnded('pdf', PDF_JOB_TTL / 1000)) {
    const datei = pdfFilePath(schluessel.slice('pdf:'.length));
    if (datei) await fsp.unlink(datei).catch(withoutMissingFile('pdf:datei loeschen'));
  }
  const files = await fsp.readdir(PDF_JOB_DIR).catch((e: unknown) => {
    withoutMissingFile('pdf:ordner lesen')(e);
    return [] as string[];
  });
  for (const f of files) {
    const fp = path.join(PDF_JOB_DIR, f);
    const st = await fsp.stat(fp).catch(withoutMissingFile('pdf:datei pruefen'));
    if (st && k.uhr.jetzt() - st.mtimeMs > PDF_JOB_TTL)
      await fsp.unlink(fp).catch(withoutMissingFile('pdf:datei loeschen'));
  }
}

/** Daran hängt die Wartezeit (etwa ein Bild je Sekunde). */
async function fehlendeBilder(
  k: CatalogContext,
  sets: Array<{ set_number?: unknown }>,
  parts: Array<{ image_local?: string | null | undefined; image_url?: string | null | undefined }>,
) {
  let fehlend = parts.filter(p => !p.image_local && p.image_url).length;
  const nummern = new Set<string>();
  for (const s of sets || []) {
    const raw = String(s?.set_number || '').trim();
    if (!raw) continue;
    nummern.add(withVersion(raw));
  }
  if (!nummern.size) return fehlend;
  try {
    const r = await k.bildlage.missingCatalogImages([...nummern]);
    const c = Number(r?.c);
    if (Number.isFinite(c)) fehlend = c;
  } catch (e) {
    reportError('pdf:wartezeit schaetzen', e);
  }
  return fehlend;
}

/** Laufen schon MAX_JOBS_PRO_USER, gibt es keine Kennung, sondern deren Zahl. */
export async function startPdfJob(
  k: CatalogContext,
  uid: number,
  sets: PayloadInput<'pdf'>['sets'],
  parts: PayloadInput<'pdf'>['parts'],
): Promise<{ jobId: string } | { laufend: number }> {
  const laufend = await k.auftraege.countRunning('pdf', uid, PDF_JOB_TTL / 1000);
  if (laufend >= MAX_JOBS_PRO_USER) return { laufend };
  const jobId = newJobId(k.uhr.jetzt());
  // Bildangaben des Clients gehen nicht in den Auftrag: Die Bilder kommen aus dem Katalog.
  const withoutImages = parts.map(p => ({ ...p, image_url: undefined, image_local: undefined }));
  const missingImages = await fehlendeBilder(k, sets, parts);
  await k.auftraege.placeJobOne(
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
