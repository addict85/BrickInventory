/** Was der Haushalt aus höheren Bereichen liest: Namen der Konten und wem eine Erfassung gehört.
 * Die Form steht hier, das SQL reicht startup (db/kontoSicht.ts, db/bestandSicht.ts). */
export interface HaushaltLesevertrag {
  /** Unterabfrage mit den Spalten id, username. */
  KONTEN: string;
  /** Die Erfassungen je Art als Unterabfrage mit den Spalten id, user_id. */
  setErfassungen(): string;
  teilErfassungen(): string;
  figurErfassungen(): string;
}
