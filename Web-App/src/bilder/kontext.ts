/** Was die Bilddienste bekommen: Zugang, Fächer, Aufträge, Haushalt, Fremdquellen und das
 * Bildwerk. Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Konfig } from '../infra/konfig';
import { mit, withContract, type Kontext } from '../infra/bereich';
import type { ImagesReadContract } from './lesevertrag';
import type { Faecher } from '../infra/zwischenspeicher';
import type { Db } from '../../db/database';
import type { JobsServices } from '../auftraege';
import type { ForeignSourcesServices } from '../fremdquellen';
import type { HouseholdServices } from '../haushalt';
import * as bildBlickfeld from './repository/bildBlickfeld';
import * as bildFehlschlaege from './repository/bildFehlschlaege';
import * as bildStammCdn from './repository/bildStammCdn';
import * as bildbedarf from './repository/bildbedarf';
import type { Uhr } from '../infra/uhr';

/** Set-Bild holen und verkleinern über den Kontext statt über den Import: So ersetzt ein
 * Test Netz und sharp an der Verdrahtung (buildServices), statt Module umzubiegen. */
export interface ImageWorker {
  /** Lädt das Set-Bild nach images/sets; null, wenn es scheitert (`info.status` nennt den HTTP-Code). */
  setBildLaden(url: string, setNumber: string, info?: { status?: number }): Promise<string | null>;
  /** Legt die Vorschau neben das Bild und liefert ihren Pfad; null, wenn es nicht ging. */
  createPreview(relPath: string): Promise<string | null>;
}

export interface ImagesDependencies {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  db: Db;
  faecher: Faecher;
  bildwerk: ImageWorker;
  fremdquellen: ForeignSourcesServices;
  auftraege: JobsServices;
  haushalt: HouseholdServices;
  lesevertrag: ImagesReadContract;
}

export const zugang = (db: Db, l: ImagesReadContract) => ({
  bildBlickfeld: {
    setsInScope: withContract(db, l)(bildBlickfeld.setsInScope),
  },
  bildFehlschlaege: {
    freshFailures: mit(db)(bildFehlschlaege.freshFailures),
    forgetFailures: mit(db)(bildFehlschlaege.forgetFailures),
    forgetAllFailures: mit(db)(bildFehlschlaege.forgetAllFailures),
    rememberFailures: mit(db)(bildFehlschlaege.rememberFailures),
  },
  bildStammCdn: {
    cdnZuBildstamm: mit(db)(bildStammCdn.cdnZuBildstamm),
  },
  bildbedarf: {
    rememberImageRequests: mit(db)(bildbedarf.rememberImageRequests),
    deleteOldImageRequests: mit(db)(bildbedarf.deleteOldImageRequests),
    countImageRequests: mit(db)(bildbedarf.countImageRequests),
    deleteAllImageRequests: mit(db)(bildbedarf.deleteAllImageRequests),
    entnimmBildwuensche: mit(db)(bildbedarf.entnimmBildwuensche),
    seriesCatalogImagesOne: mit(db)(bildbedarf.seriesCatalogImagesOne),
  },
});
export type ImagesContext = Kontext<ImagesDependencies, ReturnType<typeof zugang>>;
