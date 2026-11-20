/** What settings reads from the higher household: currency applies per household (db/householdView.ts). */
export interface SettingsReadContract {
  householdDown(konto: string): string;
  auchFremdGeteilt(ids: string): string;
  isSubAccount(konto: string): string;
}
