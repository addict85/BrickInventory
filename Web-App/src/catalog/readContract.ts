/** What the catalog reads from the higher-level inventory (image needs, ownership); columns as in db/inventoryView.ts
 * and db/stockQuantity.ts. Without imports so that repositories may read it (accounts like db/accounts.ts). */
type AccountFilter = `= $${number}` | `= ANY($${number})`;

export interface CatalogReadContract {
  setHoldings(accounts?: AccountFilter): string;
  partHoldings(accounts?: AccountFilter): string;
  figHoldings(accounts?: AccountFilter): string;
  setCounts(number: string): string;
  setQuantityJoin(basis: string, alias?: string, accounts?: AccountFilter): string;
}
