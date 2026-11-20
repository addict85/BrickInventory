/** Sets und Käufe gehören dem Bestand (docs/architektur.md); die Bereiche darüber schreiben hierüber. */
import type { ErfassungsArt } from '../../db/bestandsmenge';
import { mit } from '../infra/bereich';
import * as erfassungen from './repository/erfassungen';
import * as gemeinsam from './repository/gemeinsam';
import * as kaeufe from './repository/kaeufe';
import { manualEntryReassign } from './umhaengen';
import type { InventoryContext } from './kontext';

export interface EntryChange {
  menge?: number;
  preis?: { wert: number | null; geschaetzt: boolean };
  zustand?: string;
  datum?: string;
}

/** Nur in den übergebenen Konten: zweite Linie hinter der Prüfung des Aufrufers. */
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
