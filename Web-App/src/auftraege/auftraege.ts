
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

export type Belegung = Pick<AuftragsZeile, 'id' | 'belegt_von'>;

// ── Pausen je Art ────────────────────────────────────────────────────────────
// Eine Gegenseite drosselt (Cloudflare, CDN, Tageskontingent) oder will
// Abstand zwischen zwei Abrufen: Dann wartet die ganze Art, nicht ein Auftrag.

export interface Pause { art: string; bis: Date; grund: string | null; stufe: number }

