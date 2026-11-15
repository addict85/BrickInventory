/** Was die Geräte aus den höheren Zugängen lesen: Ein Schlüssel gilt, solange seine Token-Familie lebt
 * (db/zugangSicht.ts). */
export interface GeraeteLesevertrag {
  familieLebt(konto: string, seit: string): string;
  tokenFamilieSql(hash: string): string;
}
