/** Wie db/konten.ts; hier ohne Import, damit Repositories den Vertrag lesen dürfen (Blatt). */
type Konten = `= $${number}` | `= ANY($${number})`;

/** Was der Katalog aus dem Bestand liest, der höher liegt: welche Bilder und Zuordnungen jemand
 * braucht, und ob ein Konto ein Set hält. Die Form steht hier, das SQL reicht startup
 * (db/bestandSicht.ts, db/bestandsmenge.ts). */
export interface KatalogLesevertrag {
  /** Sets im Bestand: id, user_id, set_number, storage_id, added_at. */
  setBestand(konten?: Konten): string;
  /** Teile im Bestand: id, user_id, set_number, part_number, color_id, source, storage_id, added_at. */
  teilBestand(konten?: Konten): string;
  /** Figuren im Bestand: id, user_id, set_number, fig_number, source, storage_id. */
  figurBestand(konten?: Konten): string;
  /** Bedingung: Das Set `nummer` wird von irgendeinem Konto gehalten, gemerkt oder beobachtet. */
  setZaehlt(nummer: string): string;
  /** JOIN-Quelle `<alias>.menge`: die Stückzahl der Set-Zeile `bezug` aus ihren Käufen. */
  mengeJoin(bezug: string, alias?: string, konten?: Konten): string;
}
