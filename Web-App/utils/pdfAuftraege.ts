import * as db from '../db/database';
import { notify } from './pgNotify';

/**
 * Status der PDF-Aufträge. Er steht in der Datenbank, damit jeder
 * Arbeitsprozess denselben Stand sieht; ein NOTIFY auf PDF_KANAL weckt die
 * Statusströme sofort, auch wenn der Auftrag in einem anderen Prozess läuft.
 */
export const PDF_KANAL = 'pdf_auftrag';

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
