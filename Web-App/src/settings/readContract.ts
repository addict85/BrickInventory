/** What settings reads from the higher household: currency applies per household (db/householdView.ts). */
export interface SettingsReadContract {
  householdDown(account: string): string;
  alsoSharedByOthers(ids: string): string;
  isSubAccount(account: string): string;
}
