/** What the services get; separate from area.ts so no import cycle forms. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as wanted from './repository/wanted';
import * as wantedListe from './repository/wantedListe';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { SetsDienste } from '../sets';
import type { FremdquellenDienste } from '../fremdquellen';
import type { BilderDienste } from '../bilder';
import type { Uhr } from '../infra/uhr';

export interface WantedDependencies {
  uhr: Uhr;
  db: Db;
  einstellungen: EinstellungenDienste;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  fremdquellen: FremdquellenDienste;
  bilder: BilderDienste;
  sets: SetsDienste;
}

export const access = (db: Db) => ({
  wanted: {
    markSetWanted: mit(db)(wanted.markSetWanted),
    removeWantedEntry: mit(db)(wanted.removeWantedEntry),
    isWanted: mit(db)(wanted.isWanted),
    transferWantedEntry: mit(db)(wanted.transferWantedEntry),
    wantedListInScope: mit(db)(wanted.wantedListInScope),
    wantedListForExport: mit(db)(wanted.wantedListForExport),
  },
  // Cross-reference lookups for the BrickLink wanted-list XML import (BL→RB
  // number mapping); left under their established German names, same as
  // wantedAufloesung.ts/wantedListe.ts that call them — see the Phase 2a report.
  wantedListe: {
    zuordnungen: mit(db)(wantedListe.zuordnungen),
    nummernImKatalog: mit(db)(wantedListe.nummernImKatalog),
    farbenZuBlFarben: mit(db)(wantedListe.farbenZuBlFarben),
    farbenZuIds: mit(db)(wantedListe.farbenZuIds),
    teileBeschreibung: mit(db)(wantedListe.teileBeschreibung),
    teilFarbbilder: mit(db)(wantedListe.teilFarbbilder),
    figurenBeschreibung: mit(db)(wantedListe.figurenBeschreibung),
    setsBeschreibung: mit(db)(wantedListe.setsBeschreibung),
  },
});
export type WantedContext = Kontext<WantedDependencies, ReturnType<typeof access>>;
