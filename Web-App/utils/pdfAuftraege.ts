import path from 'path';
import crypto from 'crypto';
import fsp from 'fs/promises';
import { PDF_JOB_DIR } from './appPaths';
import * as db from '../db/database';
import { notify } from './pgNotify';
import { logAndContinue, meldeUndLiefere, meldeUndWeiter, ohneFehlendeDatei } from './httpError';
import { stelleAuftragEin } from './auftraege';
import { mitVersion } from './setNummer';

/**
 * Status der PDF-Aufträge. Er steht in der Datenbank, damit jeder
 * Arbeitsprozess denselben Stand sieht; ein NOTIFY auf PDF_KANAL weckt die
 * Statusströme sofort, auch wenn der Auftrag in einem anderen Prozess läuft.
 */
export const PDF_KANAL = 'pdf_auftrag';

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

export async function liesAuftrag(id: string): Promise<PdfAuftrag | null> {
  const z = await db.get(
    'SELECT status, fehler, user_id, fehlende_bilder, eta_sekunden FROM pdf_auftraege WHERE id = $1', [id]);
  return z ? { status: z.status, error: z.fehler ?? null, user_id: Number(z.user_id),
               missingImages: z.fehlende_bilder ?? null, etaSeconds: z.eta_sekunden ?? null } : null;
}

export async function schreibeAuftrag(id: string, a: PdfAuftrag): Promise<void> {
  await db.run(
    `INSERT INTO pdf_auftraege (id, user_id, status, fehler, fehlende_bilder, eta_sekunden, aktualisiert)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, fehler = EXCLUDED.fehler,
       fehlende_bilder = COALESCE(EXCLUDED.fehlende_bilder, pdf_auftraege.fehlende_bilder),
       eta_sekunden = COALESCE(EXCLUDED.eta_sekunden, pdf_auftraege.eta_sekunden), aktualisiert = NOW()`,
    [id, a.user_id, a.status, a.error, a.missingImages ?? null, a.etaSeconds ?? null]);
  await notify(PDF_KANAL, id);
}

/** Laufende Aufträge eines Kontos; ein hängengebliebener zählt nach `ttlMs` nicht mehr. */
export async function laufendeAuftraege(uid: number, ttlMs: number): Promise<number> {
  const z = await db.get(
    `SELECT COUNT(*)::int AS n FROM pdf_auftraege
      WHERE user_id = $1 AND status = 'running' AND aktualisiert > NOW() - make_interval(secs => $2)`,
    [uid, ttlMs / 1000]);
  return z?.n ?? 0;
}

export async function loescheAuftrag(id: string): Promise<void> {
  await db.run('DELETE FROM pdf_auftraege WHERE id = $1', [id]);
}

/** Alte Aufträge entfernen; @returns ihre Kennungen, damit die PDF-Dateien mitgehen */
export async function raeumeAuftraegeAuf(ttlMs: number): Promise<string[]> {
  const rows = await db.all(
    'DELETE FROM pdf_auftraege WHERE aktualisiert < NOW() - make_interval(secs => $1) RETURNING id', [ttlMs / 1000]);
  return rows.map((r: { id: string }) => r.id);
}

/** Ein Auftrag gilt nach zehn Minuten als verwaist; seine Datei wird gelöscht. */
export const PDF_JOB_TTL = 10 * 60 * 1000;
/** Gleichzeitig laufende PDF-Aufträge je Benutzer: Ein Auftrag lädt hunderte Bilder nach. */
export const MAX_JOBS_PRO_BENUTZER = 2;
const PDF_CLEANUP_MS = 60 * 60 * 1000;

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

/** Stündliches Aufräumen, nur im Primary (startup/backgroundJobs.ts). */
export function startPdfJobCleanup() {
  cleanOldPdfJobs().catch(logAndContinue('pdf:aufraeumen'));
  const t = setInterval(() => { cleanOldPdfJobs().catch(logAndContinue('pdf:aufraeumen')); }, PDF_CLEANUP_MS);
  t.unref?.();
  return t;
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
  const missingImages = await fehlendeBilder(sets, parts);
  await schreibeAuftrag(jobId, { status: 'running', error: null, missingImages,
    etaSeconds: Math.max(3, Math.round(missingImages) + 3), user_id: uid });
  await stelleAuftragEin('pdf', { job_id: jobId, user_id: uid, sets, parts }, { userId: uid, maxVersuche: 2 });
  return { jobId };
}
