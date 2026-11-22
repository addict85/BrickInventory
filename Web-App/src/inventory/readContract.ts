/** What the inventory reads via read building blocks; columns as in db/inventoryView.ts and db/stockQuantity.ts.
 * Only the instructions are higher (src/sets), sets and purchases belong to it. Without imports so that
 * repositories may read it (accounts like db/accounts.ts). */
type AccountFilter = `= $${number}` | `= ANY($${number})`;

export interface InventoryReadContract {
  setHoldings(accounts?: AccountFilter): string;
  setAcquisitions(accounts?: AccountFilter): string;
  partAcquisitions(accounts?: AccountFilter): string;
  figAcquisitions(accounts?: AccountFilter): string;
  instructions(accounts?: AccountFilter): string;
  mengeJoin(basis: string, alias?: string, accounts?: AccountFilter): string;
  quantityJoin(basis: string, kind: 'part' | 'fig', alias?: string, accounts?: AccountFilter): string;
}
