/** Was der Katalog aus dem höheren Bestand liest (Bildbedarf, Besitz); Spalten wie in db/inventoryView.ts
 * und db/stockQuantity.ts. Ohne Import, damit Repositories ihn lesen dürfen (Konten wie db/accounts.ts). */
type Konten = `= $${number}` | `= ANY($${number})`;

export interface CatalogReadContract {
  setBestand(konten?: Konten): string;
  teilBestand(konten?: Konten): string;
  figurBestand(konten?: Konten): string;
  setZaehlt(nummer: string): string;
  mengeJoin(bezug: string, alias?: string, konten?: Konten): string;
}
