/** Was die Einstellungen aus dem höheren Haushalt lesen: Die Währung gilt je Haushalt (db/haushaltSicht.ts). */
export interface EinstellungenLesevertrag {
  haushaltAbwaerts(konto: string): string;
  auchFremdGeteilt(ids: string): string;
  istUnterkonto(konto: string): string;
}
