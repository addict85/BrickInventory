/** Wie db/konten.ts; hier ohne Import, damit Repositories den Vertrag lesen dürfen (Blatt). */
type Konten = `= $${number}` | `= ANY($${number})`;

/** Was der Bestand aus Sets, Käufen und Anleitungen liest, die höher liegen: Zahlen, Lagerorte
 * und Export hängen daran. Die Form steht hier, das SQL reicht startup (db/bestandSicht.ts,
 * db/bestandsmenge.ts); Erfassungen wie im Lesevertrag der Finanzen. */
export interface BestandLesevertrag {
  /** id, user_id, set_number, storage_id, added_at. */
  setBestand(konten?: Konten): string;
  /** Erfassungen mit set_number, purchase_price. */
  setErfassungen(konten?: Konten): string;
  /** Erfassungen mit part_number, color_id, unit_price. */
  teilErfassungen(konten?: Konten): string;
  /** Erfassungen mit fig_number, unit_price. */
  figurErfassungen(konten?: Konten): string;
  /** Eigene Anleitungen: user_id, set_number. */
  anleitungen(konten?: Konten): string;
  /** JOIN-Quelle `<alias>.menge`: die Stückzahl der Set-Zeile `bezug` aus ihren Käufen. */
  mengeJoin(bezug: string, alias?: string, konten?: Konten): string;
  /** JOIN-Quellen `<alias>_e`, `<alias>_k` für die Stückzahl der Bestandszeile `bezug` (teilmengeAus). */
  teilmengeJoin(bezug: string, art: 'part' | 'fig', alias?: string, konten?: Konten): string;
}
