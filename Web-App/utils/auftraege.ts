import { randomUUID } from 'crypto';
import * as db from '../db/database';
import { notify } from './pgNotify';

/**
 * Die dauerhafte Auftragstabelle (Migration 0066): Einstellen geht aus jedem
 * Prozess, abgearbeitet wird im Primär-Worker (jobs/auftragsWorker.ts). Das
 * NOTIFY weckt ihn sofort; geht es verloren, findet ihn sein Takt.
 */
export const AUFTRAG_KANAL = 'auftraege';

/** Was im Baum als Auftrag läuft; der Worker kennt für jede Art einen Bearbeiter. */
export type AuftragsArt = 'nacharbeit' | 'bilder' | 'pdf' | 'csv_import';

export interface AuftragsZeile {
  id: string;
  art: AuftragsArt;
  nutzlast: Record<string, unknown>;
  user_id: number | null;
  status: 'offen' | 'laeuft' | 'erledigt' | 'fehler';
  versuche: number;
  max_versuche: number;
  belegt_von: string | null;
  fehler: string | null;
}

export interface Einstellen {
  userId?: number | null;
  /** Steht ein offener Auftrag mit diesem Schlüssel schon da, kommt kein zweiter dazu. */
  schluessel?: string;
  maxVersuche?: number;
  /** Frühestens nach so vielen Sekunden. */
  nachSekunden?: number;
}

/** @returns die Kennung, oder null, wenn derselbe Auftrag schon offen steht */
export async function stelleAuftragEin(art: AuftragsArt, nutzlast: Record<string, unknown>,
                                       o: Einstellen = {}): Promise<string | null> {
  const z = await db.get(
    `INSERT INTO auftraege (art, nutzlast, user_id, schluessel, max_versuche, next_run_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6))
     ON CONFLICT (schluessel) WHERE status = 'offen' DO NOTHING
     RETURNING id`,
    [art, JSON.stringify(nutzlast), o.userId ?? null, o.schluessel ?? null, o.maxVersuche ?? 5, o.nachSekunden ?? 0]);
  await notify(AUFTRAG_KANAL, art);
  return z ? String(z.id) : null;
}

/**
 * Den nächsten fälligen Auftrag belegen. Ein 'laeuft' mit abgelaufener Frist
 * gehört einem Prozess, den es nicht mehr gibt, und wird neu vergeben.
 * SKIP LOCKED: Zwei Worker greifen nie dieselbe Zeile.
 */
export async function belegeAuftrag(arten: readonly string[], fristSek: number,
                                    belegtVon: string = randomUUID()): Promise<AuftragsZeile | null> {
  const z = await db.get(
    `UPDATE auftraege SET status = 'laeuft', versuche = versuche + 1, belegt_von = $1,
            next_run_at = NOW() + make_interval(secs => $2), aktualisiert = NOW()
      WHERE id = (SELECT id FROM auftraege
                   WHERE status IN ('offen', 'laeuft') AND next_run_at <= NOW() AND art = ANY($3)
                   ORDER BY next_run_at, id LIMIT 1
                   FOR UPDATE SKIP LOCKED)
      RETURNING id, art, nutzlast, user_id, status, versuche, max_versuche, belegt_von, fehler`,
    [belegtVon, fristSek, [...arten]]);
  return z ? { ...z, id: String(z.id) } : null;
}

/** Frist verlängern. @returns false, wenn der Auftrag nicht mehr diesem Lauf gehört */
export async function lebenszeichen(a: Pick<AuftragsZeile, 'id' | 'belegt_von'>, fristSek: number): Promise<boolean> {
  const r = await db.run(
    `UPDATE auftraege SET next_run_at = NOW() + make_interval(secs => $3), aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft'`, [a.id, a.belegt_von, fristSek]);
  return (r?.changes ?? 0) > 0;
}

/** PDF und CSV tragen ganze Listen; erledigt braucht die niemand mehr. */
export async function erledigt(a: Pick<AuftragsZeile, 'id' | 'belegt_von'>): Promise<void> {
  await db.run(
    `UPDATE auftraege SET status = 'erledigt', belegt_von = NULL, fehler = NULL, aktualisiert = NOW(),
            nutzlast = CASE WHEN art IN ('pdf', 'csv_import') THEN '{}'::jsonb ELSE nutzlast END
      WHERE id = $1 AND belegt_von = $2`, [a.id, a.belegt_von]);
}

/** Wartezeit vor dem nächsten Versuch: 30 s, verdoppelt je Versuch, höchstens eine Stunde. */
export function wartezeitSek(versuch: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, versuch - 1));
}

/** @returns true, wenn es der letzte Versuch war und der Auftrag jetzt 'fehler' ist */
export async function fehlgeschlagen(a: AuftragsZeile, fehler: string): Promise<boolean> {
  const endgueltig = a.versuche >= a.max_versuche;
  await db.run(
    `UPDATE auftraege SET status = $3, fehler = $4, belegt_von = NULL, aktualisiert = NOW(),
            next_run_at = NOW() + make_interval(secs => $5)
      WHERE id = $1 AND belegt_von = $2`,
    [a.id, a.belegt_von, endgueltig ? 'fehler' : 'offen', fehler.slice(0, 2000), wartezeitSek(a.versuche)]);
  return endgueltig;
}

/** Beim Herunterfahren zurückgeben: sofort wieder fällig, der Versuch zählt nicht. */
export async function gibZurueck(a: Pick<AuftragsZeile, 'id' | 'belegt_von'>): Promise<void> {
  await db.run(
    `UPDATE auftraege SET status = 'offen', versuche = GREATEST(versuche - 1, 0), belegt_von = NULL,
            next_run_at = NOW(), aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft'`, [a.id, a.belegt_von]);
}

/** Erledigte nach sieben, gescheiterte nach dreissig Tagen entfernen. */
export async function raeumeErledigteAuf(): Promise<number> {
  const r = await db.run(
    `DELETE FROM auftraege
      WHERE (status = 'erledigt' AND aktualisiert < NOW() - INTERVAL '7 days')
         OR (status = 'fehler'   AND aktualisiert < NOW() - INTERVAL '30 days')`);
  return r?.changes ?? 0;
}
