/** What settings reads from the higher household: currency applies per household (db/haushaltSicht.ts). */
export interface SettingsReadContract {
  haushaltAbwaerts(konto: string): string;
  auchFremdGeteilt(ids: string): string;
  istUnterkonto(konto: string): string;
}
