/** Einstellungen für die Schlüssel, Aufträge für die Brickset-Wiedervorlage. Getrennt von
 * bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import { mit, type Kontext } from '../infra/bereich';
import type { Db } from '../../db/database';
import type { AuftraegeDienste } from '../auftraege';
import type { EinstellungenDienste } from '../einstellungen';
import * as apiKontingent from './repository/apiKontingent';
import * as apiTakt from './repository/apiTakt';
import type { Quellen } from './quellen';

export interface FremdquellenAbhaengigkeiten {
  db: Db;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  /** Was ein Test statt der echten Klienten gibt; gelesen beim Aufruf (bereich.ts). */
  ersatz?: Partial<Quellen> | undefined;
}

export const zugang = (db: Db) => ({
  apiKontingent: {
    zaehleApiAufruf: mit(db)(apiKontingent.zaehleApiAufruf),
    aufrufeHeute: mit(db)(apiKontingent.aufrufeHeute),
    aufrufeJeKonto: mit(db)(apiKontingent.aufrufeJeKonto),
    setzeApiZaehlerZurueck: mit(db)(apiKontingent.setzeApiZaehlerZurueck),
  },
  apiTakt: {
    belegeTakt: mit(db)(apiTakt.belegeTakt),
    schiebeTakt: mit(db)(apiTakt.schiebeTakt),
  },
});
export type FremdquellenKontext = Kontext<FremdquellenAbhaengigkeiten, ReturnType<typeof zugang>>;
