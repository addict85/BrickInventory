/** Was die Bilddienste bekommen: Zugang, Fächer, Aufträge, Haushalt, Fremdquellen und das
 * Bildwerk. Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import { bindeZugang, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import type { Db } from '../../db/database';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';
import type { FremdquellenDienste } from '../fremdquellen';
import type { HaushaltDienste } from '../haushalt';
import * as bildBlickfeld from './repository/bildBlickfeld';
import * as bildFehlschlaege from './repository/bildFehlschlaege';
import * as bildStammCdn from './repository/bildStammCdn';
import * as bildbedarf from './repository/bildbedarf';
import * as bildlage from './repository/bildlage';

/** Set-Bild holen und verkleinern über den Kontext statt über den Import: So ersetzt ein
 * Test Netz und sharp an der Verdrahtung (baueDienste), statt Module umzubiegen. */
export interface Bildwerk {
  /** Lädt das Set-Bild nach images/sets; null, wenn es scheitert (`info.status` nennt den HTTP-Code). */
  setBildLaden(url: string, setNumber: string, info?: { status?: number }): Promise<string | null>;
  /** Legt die Vorschau neben das Bild und liefert ihren Pfad; null, wenn es nicht ging. */
  vorschauErzeugen(relPfad: string): Promise<string | null>;
}

export interface BilderAbhaengigkeiten {
  db: Db;
  faecher: Faecher;
  bildwerk: Bildwerk;
  fremdquellen: FremdquellenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  nacharbeit: Nacharbeit;
}

export const zugang = (db: Db) => ({
  bildBlickfeld: bindeZugang(db, bildBlickfeld),
  bildFehlschlaege: bindeZugang(db, bildFehlschlaege),
  bildStammCdn: bindeZugang(db, bildStammCdn),
  bildbedarf: bindeZugang(db, bildbedarf),
  bildlage: bindeZugang(db, bildlage),
});
export type BilderKontext = Kontext<BilderAbhaengigkeiten, ReturnType<typeof zugang>>;
