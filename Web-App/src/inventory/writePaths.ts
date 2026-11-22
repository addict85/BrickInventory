/** Sets and purchases belong to the inventory (docs/architektur.md); the areas above write via this. */
import type { AcquisitionKind } from '../../db/stockQuantity';
import { bound } from '../infra/area';
import * as acquisitions from './repository/acquisitions';
import * as shared from './repository/shared';
import * as purchases from './repository/purchases';
import { manualEntryReassign } from './reassign';
import type { InventoryContext } from './context';

export interface EntryChange {
  menge?: number;
  preis?: { wert: number | null; geschaetzt: boolean };
  zustand?: string;
  datum?: string;
}

/** Only in the passed accounts: a second line behind the caller's check. */
async function change(k: InventoryContext, art: AcquisitionKind, id: number, konten: number[], a: EntryChange) {
  if (a.menge !== undefined) await acquisitions.setEntryQuantity(k.db, art, id, a.menge, konten);
  if (a.preis) await acquisitions.setEntryPrice(k.db, art, id, a.preis.wert, a.preis.geschaetzt, konten);
  if (a.zustand !== undefined) await acquisitions.setEntryState(k.db, art, id, a.zustand, konten);
  if (a.datum) await acquisitions.setEntryDate(k.db, art, id, a.datum, konten);
}

export const writePaths = (k: InventoryContext) => ({
  createSet: bound(k.db, shared.createSet),
  setNewest: bound(k.db, purchases.setNewest),
  erfassung: {
    inWriteScope: bound(k.db, acquisitions.entryInWriteField),
    change: bound(k)(change),
    remove: bound(k.db, acquisitions.deleteEntry),
  },
  manualEntryReassign: bound(k)(manualEntryReassign),
});
