import path from 'path';
import crypto from 'crypto';
import fsp from 'fs/promises';
import { PDF_JOB_DIR } from '../infra/appPaths';
import * as db from '../../db/database';
import { meldeUndLiefere, meldeUndWeiter, ohneFehlendeDatei } from '../infra/httpError';
import { stelleAuftragEin } from './auftraege';
import { mitVersion } from '../sets/setNummer';

/**
 * PDF-Aufträge sind Aufträge der Art 'pdf' mit dem Schlüssel `pdf:<Kennung>`;
 * Status, Fehler und Wartezeit stehen dort (Fortschritt), und jeder
 * Statuswechsel weckt die Statusströme über AUFTRAG_STAND_KANAL.
 */
export const pdfSchluessel = (id: string) => `pdf:${id}`;

/**
 * Vom Server erzeugt: `${Date.now()}-${12 Hex-Zeichen}`. Alles andere wird
 * abgewiesen, denn die Kennung wird zum Dateinamen. Die alte Form (4–10
 * Zeichen) bleibt gültig, damit Aufträge über ein Update abrufbar bleiben.
 */
const JOB_ID_RE = /^\d{10,16}-[a-z0-9]{4,12}$/;
export function gueltigeAuftragsKennung(id: string): boolean { return JOB_ID_RE.test(id); }

/** Die PDF-Datei eines Auftrags, oder null für eine ungültige Kennung. */
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

/** offen und laeuft heissen für die Oberfläche 'running'; abgebrochen ist ein Fehler. */
const STATUS: Record<string, PdfAuftrag['status']> = { offen: 'running', laeuft: 'running', erledigt: 'done' };

export async function liesAuftrag(id: string): Promise<PdfAuftrag | null> {
  const z = await db.get(
    `SELECT status, fehler, user_id, fortschritt FROM auftraege
      WHERE art = 'pdf' AND schluessel = $1 ORDER BY id DESC LIMIT 1`, [pdfSchluessel(id)]);
  return z ? { status: STATUS[z.status] ?? 'error', error: z.status === 'erledigt' ? null : z.fehler ?? null,
               user_id: Number(z.user_id), missingImages: z.fortschritt?.fehlendeBilder ?? null,
               etaSeconds: z.fortschritt?.etaSekunden ?? null } : null;
}

/** Laufende Aufträge eines Kontos; ein hängengebliebener zählt nach `ttlMs` nicht mehr. */
export async function laufendeAuftraege(uid: number, ttlMs: number): Promise<number> {
  const z = await db.get(
    `SELECT COUNT(*)::int AS n FROM auftraege
      WHERE art = 'pdf' AND user_id = $1 AND status IN ('offen', 'laeuft')
        AND erstellt > NOW() - make_interval(secs => $2)`, [uid, ttlMs / 1000]);
  return z?.n ?? 0;
}

export async function loescheAuftrag(id: string): Promise<void> {
  await db.run(`DELETE FROM auftraege WHERE art = 'pdf' AND schluessel = $1 AND status <> 'laeuft'`, [pdfSchluessel(id)]);
}

/** Beendete Aufträge nach `ttlMs` entfernen; @returns ihre Kennungen, damit die PDF-Dateien mitgehen */
export async function raeumeAuftraegeAuf(ttlMs: number): Promise<string[]> {
  const rows = await db.all(
    `DELETE FROM auftraege WHERE art = 'pdf' AND status IN ('erledigt', 'fehler', 'abgebrochen')
        AND aktualisiert < NOW() - make_interval(secs => $1)
     RETURNING substr(schluessel, 5) AS id`, [ttlMs / 1000]);
  return rows.map((r: { id: string }) => r.id);
}

/** Ein Auftrag gilt nach zehn Minuten als verwaist; seine Datei wird gelöscht. */
export const PDF_JOB_TTL = 10 * 60 * 1000;
/** Gleichzeitig laufende PDF-Aufträge je Benutzer: Ein Auftrag lädt hunderte Bilder nach. */
export const MAX_JOBS_PRO_BENUTZER = 2;

/** Kennung aus Zeit und kryptografischem Zufall: nicht erratbar, aber sortierbar. */
export function neueJobId(): string {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

/** Verwaiste Aufträge und alte Dateien entfernen. */
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

/**
 * Wie viele Bilder der beteiligten Sets lokal noch fehlen — daran hängt die
 * Wartezeit (etwa ein Bild je Sekunde). Ohne Sets zählen die Teile selbst.
 */
async function fehlendeBilder(sets: Array<{ set_number?: unknown }>, parts: Array<{ image_local?: string; image_url?: string }>) {
  let fehlend = parts.filter(p => !p.image_local && p.image_url).length;
  const nummern = new Set<string>();
  for (const s of sets || []) {
    const raw = String(s?.set_number || '').trim();
    if (!raw) continue;
    nummern.add(mitVersion(raw));
  }
  if (!nummern.size) return fehlend;
  try {
    const r = await db.get<{ c: string | number }>(
      `SELECT (SELECT COUNT(*) FROM (SELECT DISTINCT part_number, color_id FROM set_parts_catalog
                WHERE set_number = ANY($1) AND image_url IS NOT NULL AND image_local IS NULL) p)
            + (SELECT COUNT(*) FROM (SELECT DISTINCT fig_number FROM set_minifigs_catalog
                WHERE set_number = ANY($1) AND image_url IS NOT NULL AND image_local IS NULL) f) AS c`, [[...nummern]]);
    const c = Number(r?.c);
    if (Number.isFinite(c)) fehlend = c;
  } catch (e) { meldeUndWeiter('pdf:wartezeit schaetzen', e); }
  return fehlend;
}

/**
 * Einen PDF-Auftrag einstellen. Laufen schon MAX_JOBS_PRO_BENUTZER, gibt es
 * keine Kennung, sondern deren Zahl.
 */
export async function pdfAuftragStarten(uid: number, sets: Array<{ set_number?: unknown }>,
                                        parts: Array<{ image_local?: string; image_url?: string }>)
  : Promise<{ jobId: string } | { laufend: number }> {
  const laufend = await laufendeAuftraege(uid, PDF_JOB_TTL);
  if (laufend >= MAX_JOBS_PRO_BENUTZER) return { laufend };
  const jobId = neueJobId();
  // Bildangaben des Clients gehen nicht in den Auftrag: Die Bilder kommen aus dem Katalog (jobs/pdfErzeugung.ts).
  const ohneBilder = parts.map(p => ({ ...p, image_url: undefined, image_local: undefined }));
  const missingImages = await fehlendeBilder(sets, parts);
  await stelleAuftragEin('pdf', { job_id: jobId, user_id: uid, sets, parts: ohneBilder }, {
    userId: uid, maxVersuche: 2, schluessel: pdfSchluessel(jobId),
    fortschritt: { fehlendeBilder: missingImages, etaSekunden: Math.max(3, Math.round(missingImages) + 3) } });
  return { jobId };
}
