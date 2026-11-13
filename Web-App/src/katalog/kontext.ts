/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import { bindeZugang, type Kontext } from '../infra/bereich';
import type { Faecher } from '../infra/zwischenspeicher';
import type { Db } from '../../db/database';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import * as anleitungen from './repository/anleitungen';
import * as apiKontingent from './repository/apiKontingent';
import * as apiTakt from './repository/apiTakt';
import * as bildBlickfeld from './repository/bildBlickfeld';
import * as bildFehlschlaege from './repository/bildFehlschlaege';
import * as bildStammCdn from './repository/bildStammCdn';
import * as bildbedarf from './repository/bildbedarf';
import * as bildlage from './repository/bildlage';
import * as blZuordnung from './repository/blZuordnung';
import * as csvKatalog from './repository/csvKatalog';
import * as katalogCache from './repository/katalogCache';
import * as katalogStamm from './repository/katalogStamm';
import * as katalogSuche from './repository/katalogSuche';
import * as rebrickableCache from './repository/rebrickableCache';
import * as setInhalt from './repository/setInhalt';
import * as teileAnreicherung from './repository/teileAnreicherung';

/** Set-Bild holen und verkleinern über den Kontext statt über den Import: So ersetzt ein
 * Test Netz und sharp an der Verdrahtung (baueDienste), statt Module umzubiegen. */
export interface Bildwerk {
  /** Lädt das Set-Bild nach images/sets; null, wenn es scheitert (`info.status` nennt den HTTP-Code). */
  setBildLaden(url: string, setNumber: string, info?: { status?: number }): Promise<string | null>;
  /** Legt die Vorschau neben das Bild und liefert ihren Pfad; null, wenn es nicht ging. */
  vorschauErzeugen(relPfad: string): Promise<string | null>;
}

export interface KatalogAbhaengigkeiten {
  db: Db;
  faecher: Faecher;
  bildwerk: Bildwerk;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  nacharbeit: Nacharbeit;
}

export const zugang = (db: Db) => ({
  anleitungen: bindeZugang(db, anleitungen),
  apiKontingent: bindeZugang(db, apiKontingent),
  apiTakt: bindeZugang(db, apiTakt),
  bildBlickfeld: bindeZugang(db, bildBlickfeld),
  bildFehlschlaege: bindeZugang(db, bildFehlschlaege),
  bildStammCdn: bindeZugang(db, bildStammCdn),
  bildbedarf: bindeZugang(db, bildbedarf),
  bildlage: bindeZugang(db, bildlage),
  blZuordnung: bindeZugang(db, blZuordnung),
  csvKatalog: bindeZugang(db, csvKatalog),
  katalogCache: bindeZugang(db, katalogCache),
  katalogStamm: bindeZugang(db, katalogStamm),
  katalogSuche: bindeZugang(db, katalogSuche),
  rebrickableCache: bindeZugang(db, rebrickableCache),
  setInhalt: bindeZugang(db, setInhalt),
  teileAnreicherung: bindeZugang(db, teileAnreicherung),
});
export type KatalogKontext = Kontext<KatalogAbhaengigkeiten, ReturnType<typeof zugang>>;
