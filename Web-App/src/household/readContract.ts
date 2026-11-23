/** What the household reads from higher-level areas: account names, owners of an acquisition
 * (db/accountView.ts, db/inventoryView.ts). */
export interface HouseholdReadContract {
  ACCOUNTS: string;
  setAcquisitions(): string;
  partAcquisitions(): string;
  figAcquisitions(): string;
}
