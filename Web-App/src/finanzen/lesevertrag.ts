/** Wie db/konten.ts; hier ohne Import, damit Repositories den Vertrag lesen dürfen (Blatt). */
type Konten = `= $${number}` | `= ANY($${number})`;

/** Was die Finanzen aus Bestand, Käufen und Merkliste lesen, die höher liegen: Wert und Preise
 * hängen daran, was ein Konto hält und wie es gekauft hat. Die Form steht hier, das SQL reicht
 * startup (db/bestandSicht.ts, db/bestandsmenge.ts). Erfassungen tragen id, user_id, quantity,
 * condition, created_at, currency, price_estimated, tag und den Preis ihrer Art. */
export interface FinanzenLesevertrag {
  /** id, user_id, set_number, storage_id, added_at. */
  setBestand(konten?: Konten): string;
  /** id, user_id, set_number, part_number, color_id, source, storage_id, added_at. */
  teilBestand(konten?: Konten): string;
  /** id, user_id, set_number, fig_number, source, storage_id. */
  figurBestand(konten?: Konten): string;
  /** Erfassungen mit set_number, purchase_price. */
  setErfassungen(konten?: Konten): string;
  /** Erfassungen mit part_number, color_id, unit_price. */
  teilErfassungen(konten?: Konten): string;
  /** Erfassungen mit fig_number, unit_price. */
  figurErfassungen(konten?: Konten): string;
  /** user_id, set_number, condition. */
  merkliste(konten?: Konten): string;
  /** JOIN-Quelle `<alias>.menge`: die Stückzahl der Set-Zeile `bezug` aus ihren Käufen. */
  mengeJoin(bezug: string, alias?: string, konten?: Konten): string;
  /** JOIN-Quellen `<alias>_e`, `<alias>_k` für die Stückzahl der Bestandszeile `bezug` (teilmengeAus). */
  teilmengeJoin(bezug: string, art: 'part' | 'fig', alias?: string, konten?: Konten): string;
}
