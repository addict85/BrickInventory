/** Was der Haushalt aus höheren Bereichen liest: Namen der Konten, Besitzer einer Erfassung
 * (db/kontoSicht.ts, db/bestandSicht.ts). */
export interface HouseholdReadContract {
  KONTEN: string;
  setErfassungen(): string;
  teilErfassungen(): string;
  figurErfassungen(): string;
}
