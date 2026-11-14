import path from 'node:path';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { PDF_JOB_DIR } from '../infra/appPaths';
import { meldeFehler, ohneFehlendeDatei } from '../infra/fehler';
import { stelleAuftragEin } from './dienst';
import type { NutzlastEingabe } from './nutzlasten';
import { mitVersion } from '../infra/setNummer';
import type { AuftraegeKontext } from './kontext';

/** Jeder Statuswechsel weckt die Statusströme über AUFTRAG_STAND_KANAL. */
export const pdfSchluessel = (id: string) => `pdf:${id}`;

/** Die Kennung wird zum Dateinamen, darum alles andere abgewiesen. Die alte
 * Form bleibt gültig, damit Aufträge über ein Update abrufbar bleiben. */
const JOB_ID_RE = /^\d{10,16}-[a-z0-9]{4,12}$/;
export function gueltigeAuftragsKennung(id: string): boolean {
  return JOB_ID_RE.test(id);
}

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

/** Unter Zeilenschutz und nach Konto gefiltert: Ein fremder Auftrag ist keiner. */
export async function liesAuftrag(k: AuftraegeKontext, id: string, uid: number): Promise<PdfAuftrag | null> {
  const z = await k.pdfAuftraege.pdfAuftragZeile(pdfSchluessel(id), uid);
  return z
    ? {
        status: STATUS[z.status] ?? 'error',
        error: z.status === 'erledigt' ? null : (z.fehler ?? null),
        user_id: Number(z.user_id),
        missingImages: z.fortschritt?.fehlendeBilder ?? null,
        etaSeconds: z.fortschritt?.etaSekunden ?? null,
      }
    : null;
}

/** Ein hängengebliebener zählt nach `ttlMs` nicht mehr. */
export async function laufendeAuftraege(k: AuftraegeKontext, uid: number, ttlMs: number): Promise<number> {
  const z = await k.pdfAuftraege.zaehleLaufendePdf(uid, ttlMs / 1000);
  return z?.n ?? 0;
}

export async function loescheAuftrag(k: AuftraegeKontext, id: string, uid: number): Promise<void> {
  await k.pdfAuftraege.loeschePdfAuftrag(pdfSchluessel(id), uid);
}

/** @returns die Kennungen, damit die PDF-Dateien mitgehen */
export async function raeumeAuftraegeAuf(k: AuftraegeKontext, ttlMs: number): Promise<string[]> {
  const rows = await k.pdfAuftraege.loescheAltePdfAuftraege(ttlMs / 1000);
  return rows.map((r: { id: string }) => r.id);
}

export const PDF_JOB_TTL = 10 * 60 * 1000;
/** Je Benutzer: Ein Auftrag lädt hunderte Bilder nach. */
export const MAX_JOBS_PRO_BENUTZER = 2;

/** Nicht erratbar, aber sortierbar. */
export function neueJobId(): string {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

export async function cleanOldPdfJobs(k: AuftraegeKontext) {
  for (const id of await raeumeAuftraegeAuf(k, PDF_JOB_TTL)) {
    const datei = pdfDateiPfad(id);
    if (datei) await fsp.unlink(datei).catch(ohneFehlendeDatei('pdf:datei loeschen'));
  }
  const files = await fsp.readdir(PDF_JOB_DIR).catch((e: unknown) => {
    ohneFehlendeDatei('pdf:ordner lesen')(e);
    return [] as string[];
  });
  for (const f of files) {
    const fp = path.join(PDF_JOB_DIR, f);
    const st = await fsp.stat(fp).catch(ohneFehlendeDatei('pdf:datei pruefen'));
    if (st && Date.now() - st.mtimeMs > PDF_JOB_TTL)
      await fsp.unlink(fp).catch(ohneFehlendeDatei('pdf:datei loeschen'));
  }
}

/** Daran hängt die Wartezeit (etwa ein Bild je Sekunde). */
async function fehlendeBilder(
  k: AuftraegeKontext,
  sets: Array<{ set_number?: unknown }>,
  parts: Array<{ image_local?: string | null | undefined; image_url?: string | null | undefined }>,
) {
  let fehlend = parts.filter(p => !p.image_local && p.image_url).length;
  const nummern = new Set<string>();
  for (const s of sets || []) {
    const raw = String(s?.set_number || '').trim();
    if (!raw) continue;
    nummern.add(mitVersion(raw));
  }
  if (!nummern.size) return fehlend;
  try {
    const r = await k.pdfAuftraege.fehlendeKatalogbilder([...nummern]);
    const c = Number(r?.c);
    if (Number.isFinite(c)) fehlend = c;
  } catch (e) {
    meldeFehler('pdf:wartezeit schaetzen', e);
  }
  return fehlend;
}

/** Laufen schon MAX_JOBS_PRO_BENUTZER, gibt es keine Kennung, sondern deren Zahl. */
export async function pdfAuftragStarten(
  k: AuftraegeKontext,
  uid: number,
  sets: NutzlastEingabe<'pdf'>['sets'],
  parts: NutzlastEingabe<'pdf'>['parts'],
): Promise<{ jobId: string } | { laufend: number }> {
  const laufend = await laufendeAuftraege(k, uid, PDF_JOB_TTL);
  if (laufend >= MAX_JOBS_PRO_BENUTZER) return { laufend };
  const jobId = neueJobId();
  // Bildangaben des Clients gehen nicht in den Auftrag: Die Bilder kommen aus dem Katalog.
  const ohneBilder = parts.map(p => ({ ...p, image_url: undefined, image_local: undefined }));
  const missingImages = await fehlendeBilder(k, sets, parts);
  await stelleAuftragEin(
    k,
    'pdf',
    { job_id: jobId, user_id: uid, sets, parts: ohneBilder },
    {
      userId: uid,
      maxVersuche: 2,
      schluessel: pdfSchluessel(jobId),
      fortschritt: { fehlendeBilder: missingImages, etaSekunden: Math.max(3, Math.round(missingImages) + 3) },
    },
  );
  return { jobId };
}
