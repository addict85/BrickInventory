/** Was die Geräte aus den höheren Zugängen lesen: Ein Schlüssel gilt, solange seine Token-Familie lebt
 * (db/accessView.ts). */
export interface DevicesReadContract {
  familieLebt(konto: string, seit: string): string;
  tokenFamilySql(hash: string): string;
}
