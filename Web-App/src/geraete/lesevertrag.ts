/** Was die Geräte aus den Zugängen des Kontos lesen, das höher liegt: Ein Schlüssel gilt nur,
 * solange seine Token-Familie lebt. Die Form steht hier, das SQL reicht startup (db/zugangSicht.ts). */
export interface GeraeteLesevertrag {
  /** Bedingung: Die Familie (`konto`, `seit`) hat noch ein Token. */
  familieLebt(konto: string, seit: string): string;
  /** Konto und Familie des Tokens mit dem Hash `hash`; Spalten `uid`, `seit`. */
  tokenFamilieSql(hash: string): string;
}
