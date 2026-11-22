/** Sets and purchases belong to the inventory (docs/architecture.md); the areas above write via this. */
import type { AcquisitionKind } from '../../db/stockQuantity';
import { bound } from '../infra/area';
import * as acquisitions from './repository/acquisitions';
import * as shared from './repository/shared';
import * as purchases from './repository/purchases';
import { manualEntryReassign } from './reassign';
import type { InventoryContext } from './context';

export interface EntryChange {
  quantity?: number;
  price?: { wert: number | null; estimated: boolean };
  condition?: string;
  date?: string;
}

/** Only in the passed accounts: a second line behind the caller's check. */
async function change(k: InventoryContext, kind: AcquisitionKind, id: number, accounts: number[], a: EntryChange) {
  if (a.quantity !== undefined) await acquisitions.setEntryQuantity(k.db, kind, id, a.quantity, accounts);
  if (a.price) await acquisitions.setEntryPrice(k.db, kind, id, a.price.wert, a.price.estimated, accounts);
  if (a.condition !== undefined) await acquisitions.setEntryState(k.db, kind, id, a.condition, accounts);
  if (a.date) await acquisitions.setEntryDate(k.db, kind, id, a.date, accounts);
}

export const writePaths = (k: InventoryContext) => ({
  createSet: bound(k.db, shared.createSet),
  setNewest: bound(k.db, purchases.setNewest),
  acquisition: {
    inWriteScope: bound(k.db, acquisitions.entryInWriteField),
    change: bound(k)(change),
    remove: bound(k.db, acquisitions.deleteEntry),
  },
  manualEntryReassign: bound(k)(manualEntryReassign),
});
