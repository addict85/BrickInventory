/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { mit, type Kontext } from '../infra/bereich';
import * as erfassungen from './repository/erfassungen';
import * as loeschen from './repository/loeschen';
import type { HaushaltDienste } from '../haushalt';
import type { AuftraegeDienste } from '../auftraege';
import type { KatalogDienste } from '../katalog';
import type { FinanzenDienste } from '../finanzen';
import type { BestandDienste } from '../bestand';
import type { SetsDienste } from '../sets';
import type { TeileDienste } from '../teile';
import type { FigurenDienste } from '../figuren';
import type { MerklisteDienste } from '../merkliste';

export interface SammlungAbhaengigkeiten {
  db: Db;
  haushalt: HaushaltDienste;
  auftraege: AuftraegeDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
  sets: SetsDienste;
  teile: TeileDienste;
  figuren: FigurenDienste;
  merkliste: MerklisteDienste;
}

export const zugang = (db: Db) => ({
  erfassungen: {
    kontoDerErfassung: mit(db)(erfassungen.kontoDerErfassung),
    setErfassungenImBlickfeld: mit(db)(erfassungen.setErfassungenImBlickfeld),
    zustandDerErfassung: mit(db)(erfassungen.zustandDerErfassung),
  },
  loeschen: {
    manuelleFigurenDesKontos: mit(db)(loeschen.manuelleFigurenDesKontos),
    manuelleTeileDesKontos: mit(db)(loeschen.manuelleTeileDesKontos),
    setsDesKontos: mit(db)(loeschen.setsDesKontos),
  },
});
export type SammlungKontext = Kontext<SammlungAbhaengigkeiten, ReturnType<typeof zugang>>;
