import { notify } from '../../db/pgNotify';

/**
 * Die Auftragstabelle (Migrationen 0066, 0080): jede Hintergrundarbeit als
 * Zeile. Einstellen geht aus jedem Prozess, abgearbeitet wird im Job-Prozess
 * (jobs/auftragsWorker.ts). Das NOTIFY weckt ihn sofort; geht es verloren,
 * findet ihn sein Takt.
 */
export const AUFTRAG_KANAL = 'auftraege';
/** Ein Auftrag hat seinen Stand geändert; die Nutzlast ist sein Schlüssel oder seine Kennung. */
export const AUFTRAG_STAND_KANAL = 'auftrag_stand';

/** Was im Baum als Auftrag läuft; der Worker kennt für jede Art einen Bearbeiter. */
export const AUFTRAGS_ARTEN = [
  'nacharbeit', 'bilder', 'pdf', 'csv_import', 'wechselkurse',
  'anleitung', 'brickset', 'bildbedarf', 'bilder_neu_laden', 'nachlauf',
  'csv_sync', 'preise', 'bild_nachlauf', 'aufraeumen', 'aufraeumen_taeglich',
] as const;
export type AuftragsArt = typeof AUFTRAGS_ARTEN[number];

export type AuftragsStatus = 'offen' | 'laeuft' | 'erledigt' | 'fehler' | 'abgebrochen';

/** Stand eines laufenden Auftrags für die Anzeige. */
export interface Fortschritt { erledigt?: number; gesamt?: number; text?: string | null; [k: string]: unknown }

export interface AuftragsZeile {
  id: string;
  art: AuftragsArt;
  nutzlast: Record<string, unknown>;
  user_id: number | null;
  schluessel: string | null;
  status: AuftragsStatus;
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
  /** Frühestens zu diesem Zeitpunkt; geht nachSekunden vor. */
  faelligAb?: Date;
  fortschritt?: Fortschritt;
}

export const SPALTEN = 'id, art, nutzlast, user_id, schluessel, status, versuche, max_versuche, belegt_von, fehler';
export const alsZeile = (z: any): AuftragsZeile => ({ ...z, id: String(z.id) });

export type Belegung = Pick<AuftragsZeile, 'id' | 'belegt_von'>;

/** Ein Statuswechsel weckt, wer auf den Auftrag wartet (z. B. den PDF-Statusstrom). */
export async function meldeStand(z: { s: string } | undefined): Promise<void> {
  if (z) await notify(AUFTRAG_STAND_KANAL, z.s);
}

/** Wartezeit vor dem nächsten Versuch: 30 s, verdoppelt je Versuch, höchstens eine Stunde. */
export function wartezeitSek(versuch: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, versuch - 1));
}

// ── Pausen je Art ────────────────────────────────────────────────────────────
// Eine Gegenseite drosselt (Cloudflare, CDN, Tageskontingent) oder will
// Abstand zwischen zwei Abrufen: Dann wartet die ganze Art, nicht ein Auftrag.

export interface Pause { art: string; bis: Date; grund: string | null; stufe: number }

