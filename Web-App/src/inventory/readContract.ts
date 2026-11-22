/** What the inventory reads via read building blocks; columns as in db/inventoryView.ts and db/stockQuantity.ts.
 * Only the instructions are higher (src/sets), sets and purchases belong to it. Without imports so that
 * repositories may read it (accounts like db/accounts.ts). */
type Konten = `= $${number}` | `= ANY($${number})`;

export interface InventoryReadContract {
  setBestand(konten?: Konten): string;
  setErfassungen(konten?: Konten): string;
  teilErfassungen(konten?: Konten): string;
  figurErfassungen(konten?: Konten): string;
  anleitungen(konten?: Konten): string;
  mengeJoin(basis: string, alias?: string, konten?: Konten): string;
  teilmengeJoin(basis: string, art: 'part' | 'fig', alias?: string, konten?: Konten): string;
}
