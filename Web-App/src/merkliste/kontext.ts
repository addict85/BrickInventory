/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as merkliste from './repository/merkliste';
import * as wantedListe from './repository/wantedListe';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { SetsDienste } from '../sets';
import type { Nacharbeit } from '../auftraege';

export interface MerklisteAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  haushalt: HaushaltDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  nacharbeit: Nacharbeit;
  sets: SetsDienste;
}

export const zugang = (db: Db) => ({
  merkliste: {
    merkeSetVor: mit(db)(merkliste.merkeSetVor),
    streicheVormerkung: mit(db)(merkliste.streicheVormerkung),
    istVorgemerkt: mit(db)(merkliste.istVorgemerkt),
    uebertrageVormerkung: mit(db)(merkliste.uebertrageVormerkung),
    merklisteImBlickfeld: mit(db)(merkliste.merklisteImBlickfeld),
    merklisteFuerExport: mit(db)(merkliste.merklisteFuerExport),
  },
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
export type MerklisteKontext = Kontext<MerklisteAbhaengigkeiten, ReturnType<typeof zugang>>;
