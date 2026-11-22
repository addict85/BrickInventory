/** What the catalog reads from the higher-level inventory (image needs, ownership); columns as in db/inventoryView.ts
 * and db/stockQuantity.ts. Without imports so that repositories may read it (accounts like db/accounts.ts). */
type Konten = `= $${number}` | `= ANY($${number})`;

export interface CatalogReadContract {
  setBestand(konten?: Konten): string;
  teilBestand(konten?: Konten): string;
  figurBestand(konten?: Konten): string;
  setZaehlt(nummer: string): string;
  mengeJoin(basis: string, alias?: string, konten?: Konten): string;
}
