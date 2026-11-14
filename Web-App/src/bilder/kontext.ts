/** Was die Bilddienste bekommen: Zugang, Fächer, Aufträge, Haushalt, Fremdquellen und das
 * Bildwerk. Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Konfig } from '../infra/konfig';
import { mit, type Kontext } from '../infra/bereich';
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
  konfig: Readonly<Konfig>;
  db: Db;
  faecher: Faecher;
  bildwerk: Bildwerk;
  fremdquellen: FremdquellenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  nacharbeit: Nacharbeit;
}

export const zugang = (db: Db) => ({
  bildBlickfeld: {
    setsImBlickfeld: mit(db)(bildBlickfeld.setsImBlickfeld),
  },
  bildFehlschlaege: {
    frischeFehlschlaege: mit(db)(bildFehlschlaege.frischeFehlschlaege),
    vergissFehlschlaege: mit(db)(bildFehlschlaege.vergissFehlschlaege),
    vergissAlleFehlschlaege: mit(db)(bildFehlschlaege.vergissAlleFehlschlaege),
    merkeFehlschlaege: mit(db)(bildFehlschlaege.merkeFehlschlaege),
  },
  bildStammCdn: {
    cdnZuBildstamm: mit(db)(bildStammCdn.cdnZuBildstamm),
  },
  bildbedarf: {
    merkeBildwuensche: mit(db)(bildbedarf.merkeBildwuensche),
    loescheAlteBildwuensche: mit(db)(bildbedarf.loescheAlteBildwuensche),
    zaehleBildwuensche: mit(db)(bildbedarf.zaehleBildwuensche),
    loescheAlleBildwuensche: mit(db)(bildbedarf.loescheAlleBildwuensche),
    entnimmBildwuensche: mit(db)(bildbedarf.entnimmBildwuensche),
    reiheKatalogBilderEin: mit(db)(bildbedarf.reiheKatalogBilderEin),
  },
  bildlage: {
    setsMitFehlendenKatalogbildern: mit(db)(bildlage.setsMitFehlendenKatalogbildern),
    manuelleTeileOhneBild: mit(db)(bildlage.manuelleTeileOhneBild),
    figurenOhneBild: mit(db)(bildlage.figurenOhneBild),
    setBilderOhneDatei: mit(db)(bildlage.setBilderOhneDatei),
    merkeSetBildLokal: mit(db)(bildlage.merkeSetBildLokal),
    lokaleKatalogbilder: mit(db)(bildlage.lokaleKatalogbilder),
    teilbilder: mit(db)(bildlage.teilbilder),
    figurenbilder: mit(db)(bildlage.figurenbilder),
    fuelleSetLuecken: mit(db)(bildlage.fuelleSetLuecken),
    setsOhneAnleitungsabruf: mit(db)(bildlage.setsOhneAnleitungsabruf),
  },
});
export type BilderKontext = Kontext<BilderAbhaengigkeiten, ReturnType<typeof zugang>>;
