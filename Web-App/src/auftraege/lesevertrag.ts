/** Was die Aufträge aus dem Konto lesen, das höher liegt: Ein Auftrag läuft mit der Rolle seines
 * Kontos. Die Form steht hier, das SQL reicht startup (db/kontoSicht.ts). */
export interface AuftraegeLesevertrag {
  /** Unterabfrage mit den Spalten id, is_admin. */
  KONTEN: string;
}
