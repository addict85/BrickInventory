/** What the finances read from the higher-level inventory, purchases and wishlist; columns as in db/inventoryView.ts
 * and db/stockQuantity.ts. Without imports so that repositories may read it (accounts like db/accounts.ts). */
type Konten = `= $${number}` | `= ANY($${number})`;

export interface FinancesReadContract {
  setBestand(konten?: Konten): string;
  teilBestand(konten?: Konten): string;
  figurBestand(konten?: Konten): string;
  setErfassungen(konten?: Konten): string;
  teilErfassungen(konten?: Konten): string;
  figurErfassungen(konten?: Konten): string;
  merkliste(konten?: Konten): string;
  mengeJoin(basis: string, alias?: string, konten?: Konten): string;
  teilmengeJoin(basis: string, art: 'part' | 'fig', alias?: string, konten?: Konten): string;
}
