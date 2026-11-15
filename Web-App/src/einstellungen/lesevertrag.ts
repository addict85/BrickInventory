/** Was die Einstellungen aus dem Haushalt lesen, der höher liegt: Die Währung gilt je Haushalt.
 * Die Form steht hier, das SQL reicht startup (db/haushaltSicht.ts); `konto`, `ids` sind Platzhalter. */
export interface EinstellungenLesevertrag {
  /** Das Konto und alle Unterkonten darunter; Spalte `id`. */
  haushaltAbwaerts(konto: string): string;
  /** Unterkonten aus `ids`, die auch an einem Hauptkonto ausserhalb hängen; Spalten `id`, `haupt`. */
  auchFremdGeteilt(ids: string): string;
  /** Eine Zeile, wenn das Konto ein Hauptkonto hat. */
  istUnterkonto(konto: string): string;
}
