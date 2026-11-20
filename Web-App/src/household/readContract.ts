/** What the household reads from higher-level areas: account names, owners of an acquisition
 * (db/accountView.ts, db/inventoryView.ts). */
export interface HouseholdReadContract {
  KONTEN: string;
  setErfassungen(): string;
  teilErfassungen(): string;
  figurErfassungen(): string;
}
