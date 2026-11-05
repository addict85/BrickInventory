import path from 'path';
import crypto from 'crypto';
import fsp from 'fs/promises';
import { PDF_JOB_DIR } from '../infra/appPaths';
import { meldeUndLiefere, meldeUndWeiter, ohneFehlendeDatei } from '../infra/fehler';
import { stelleAuftragEin } from './dienst';
import { mitVersion } from '../infra/setNummer';
import * as repo from './repository/pdfAuftraege';

/** Jeder Statuswechsel weckt die Statusströme über AUFTRAG_STAND_KANAL. */
export const pdfSchluessel = (id: string) => `pdf:${id}`;

/** Die Kennung wird zum Dateinamen, darum alles andere abgewiesen. Die alte
 * Form bleibt gültig, damit Aufträge über ein Update abrufbar bleiben. */
const JOB_ID_RE = /^\d{10,16}-[a-z0-9]{4,12}$/;
export function gueltigeAuftragsKennung(id: string): boolean { return JOB_ID_RE.test(id); }

export function pdfDateiPfad(id: string): string | null {
  return gueltigeAuftragsKennung(id) ? path.join(PDF_JOB_DIR, `${id}.pdf`) : null;
}

export type PdfAuftrag = {
  status: 'running' | 'done' | 'error';
  error: string | null;
  user_id: number;
  missingImages?: number | null;
  etaSeconds?: number | null;
};

const STATUS: Record<string, PdfAuftrag['status']> = { offen: 'running', laeuft: 'running', erledigt: 'done' };

export async function liesAuftrag(id: string): Promise<PdfAuftrag | null> {
  const z = await repo.pdfAuftragZeile(pdfSchluessel(id));
  return z ? { status: STATUS[z.status] ?? 'error', error: z.status === 'erledigt' ? null : z.fehler ?? null,
               user_id: Number(z.user_id), missingImages: z.fortschritt?.fehlendeBilder ?? null,
               etaSeconds: z.fortschritt?.etaSekunden ?? null } : null;
}

/** Ein hängengebliebener zählt nach `ttlMs` nicht mehr. */
export async function laufendeAuftraege(uid: number, ttlMs: number): Promise<number> {
  const z = await repo.zaehleLaufendePdf(uid, ttlMs / 1000);
  return z?.n ?? 0;
}

export async function loescheAuftrag(id: string): Promise<void> {
  await repo.loeschePdfAuftrag(pdfSchluessel(id));
}

/** @returns die Kennungen, damit die PDF-Dateien mitgehen */
export async function raeumeAuftraegeAuf(ttlMs: number): Promise<string[]> {
  const rows = await repo.loescheAltePdfAuftraege(ttlMs / 1000);
  return rows.map((r: { id: string }) => r.id);
}

export const PDF_JOB_TTL = 10 * 60 * 1000;
/** Je Benutzer: Ein Auftrag lädt hunderte Bilder nach. */
export const MAX_JOBS_PRO_BENUTZER = 2;

/** Nicht erratbar, aber sortierbar. */
export function neueJobId(): string {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

export async function cleanOldPdfJobs() {
  for (const id of await raeumeAuftraegeAuf(PDF_JOB_TTL).catch(meldeUndLiefere('pdf:aufraeumen', [] as string[]))) {
    const datei = pdfDateiPfad(id);
    if (datei) await fsp.unlink(datei).catch(ohneFehlendeDatei('pdf:datei loeschen'));
  }
  const files = await fsp.readdir(PDF_JOB_DIR).catch((e: unknown) => { ohneFehlendeDatei('pdf:ordner lesen')(e); return [] as string[]; });
  for (const f of files) {
    const fp = path.join(PDF_JOB_DIR, f);
    const st = await fsp.stat(fp).catch(ohneFehlendeDatei('pdf:datei pruefen'));
    if (st && Date.now() - st.mtimeMs > PDF_JOB_TTL) await fsp.unlink(fp).catch(ohneFehlendeDatei('pdf:datei loeschen'));
  }
}

/** Daran hängt die Wartezeit (etwa ein Bild je Sekunde). */
async function fehlendeBilder(sets: Array<{ set_number?: unknown }>, parts: Array<{ image_local?: string | null | undefined; image_url?: string | null | undefined }>) {
  let fehlend = parts.filter(p => !p.image_local && p.image_url).length;
  const nummern = new Set<string>();
  for (const s of sets || []) {
    const raw = String(s?.set_number || '').trim();
    if (!raw) continue;
    nummern.add(mitVersion(raw));
  }
  if (!nummern.size) return fehlend;
  try {
    const r = await repo.fehlendeKatalogbilder([...nummern]);
    const c = Number(r?.c);
    if (Number.isFinite(c)) fehlend = c;
  } catch (e) { meldeUndWeiter('pdf:wartezeit schaetzen', e); }
  return fehlend;
}

/** Laufen schon MAX_JOBS_PRO_BENUTZER, gibt es keine Kennung, sondern deren Zahl. */
export async function pdfAuftragStarten(uid: number, sets: Array<{ set_number?: unknown }>,
                                        parts: Array<{ image_local?: string | null | undefined; image_url?: string | null | undefined }>)
  : Promise<{ jobId: string } | { laufend: number }> {
  const laufend = await laufendeAuftraege(uid, PDF_JOB_TTL);
  if (laufend >= MAX_JOBS_PRO_BENUTZER) return { laufend };
  const jobId = neueJobId();
  // Bildangaben des Clients gehen nicht in den Auftrag: Die Bilder kommen aus dem Katalog.
  const ohneBilder = parts.map(p => ({ ...p, image_url: undefined, image_local: undefined }));
  const missingImages = await fehlendeBilder(sets, parts);
  await stelleAuftragEin('pdf', { job_id: jobId, user_id: uid, sets, parts: ohneBilder }, {
    userId: uid, maxVersuche: 2, schluessel: pdfSchluessel(jobId),
    fortschritt: { fehlendeBilder: missingImages, etaSekunden: Math.max(3, Math.round(missingImages) + 3) } });
  return { jobId };
}
