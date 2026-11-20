/** Was der Haushalt aus höheren Bereichen liest: Namen der Konten, Besitzer einer Erfassung
 * (db/accountView.ts, db/inventoryView.ts). */
export interface HouseholdReadContract {
  KONTEN: string;
  setErfassungen(): string;
  teilErfassungen(): string;
  figurErfassungen(): string;
}
