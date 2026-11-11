/** Die Fabrik des Bereichs: Die Repositories nehmen den Zugang als ersten
 * Parameter; erzeugeKatalog bindet ihn einmal für alle, und die Dienste lesen und
 * schreiben nur über das Ergebnis (katalog(), prozess.ts). Wer eine eigene
 * Transaktion oder Sperrverbindung hält, ruft das Repository direkt damit auf. */
import { bindeZugang } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import type { KatalogKontext } from './kontext';
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

export function erzeugeKatalog(kk: KatalogKontext) {
  const { db } = kk;
  return {
    db,
    faecher: new Faecher(),
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
  };
}

export type KatalogDienste = ReturnType<typeof erzeugeKatalog>;
