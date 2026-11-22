/** Sets and purchases belong to the inventory (docs/architektur.md); the areas above write via this. */
import type { ErfassungsArt } from '../../db/stockQuantity';
import { mit } from '../infra/area';
import * as erfassungen from './repository/acquisitions';
import * as gemeinsam from './repository/shared';
import * as kaeufe from './repository/purchases';
import { manualEntryReassign } from './reassign';
import type { InventoryContext } from './context';

export interface EntryChange {
  menge?: number;
  preis?: { wert: number | null; geschaetzt: boolean };
  zustand?: string;
  datum?: string;
}

/** Only in the passed accounts: a second line behind the caller's check. */
async function aendere(k: InventoryContext, art: ErfassungsArt, id: number, konten: number[], a: EntryChange) {
  if (a.menge !== undefined) await erfassungen.setEntryQuantity(k.db, art, id, a.menge, konten);
  if (a.preis) await erfassungen.setEntryPrice(k.db, art, id, a.preis.wert, a.preis.geschaetzt, konten);
  if (a.zustand !== undefined) await erfassungen.setEntryState(k.db, art, id, a.zustand, konten);
  if (a.datum) await erfassungen.setEntryDate(k.db, art, id, a.datum, konten);
}

export const schreibwege = (k: InventoryContext) => ({
  putSetAn: mit(k.db, gemeinsam.putSetAn),
  setNewest: mit(k.db, kaeufe.setNewest),
  erfassung: {
    imSchreibfeld: mit(k.db, erfassungen.entryInWriteField),
    aendere: mit(k)(aendere),
    loesche: mit(k.db, erfassungen.deleteEntry),
  },
  manualEntryReassign: mit(k)(manualEntryReassign),
});
