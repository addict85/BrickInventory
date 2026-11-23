/** What the finances read from the higher-level inventory, purchases and wishlist; columns as in db/inventoryView.ts
 * and db/stockQuantity.ts. Without imports so that repositories may read it (accounts like db/accounts.ts). */
type AccountFilter = `= $${number}` | `= ANY($${number})`;

export interface FinancesReadContract {
  setHoldings(accounts?: AccountFilter): string;
  partHoldings(accounts?: AccountFilter): string;
  figHoldings(accounts?: AccountFilter): string;
  setAcquisitions(accounts?: AccountFilter): string;
  partAcquisitions(accounts?: AccountFilter): string;
  figAcquisitions(accounts?: AccountFilter): string;
  wantedList(accounts?: AccountFilter): string;
  setQuantityJoin(basis: string, alias?: string, accounts?: AccountFilter): string;
  quantityJoin(basis: string, kind: 'part' | 'fig', alias?: string, accounts?: AccountFilter): string;
}
