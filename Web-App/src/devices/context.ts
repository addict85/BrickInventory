/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/config';
import type { Uhr } from '../infra/clock';
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/area';
import type { DevicesReadContract } from './readContract';
import type { JobsServices } from '../jobQueue';
import * as geraeteSchluessel from './repository/deviceKeys';

export interface DevicesDependencies {
  konfig: Readonly<Konfig>;
  db: Db;
  uhr: Uhr;
  /** Der Laufzustand hält die Widerrufsliste der Attestation (katalog/widerrufsliste.ts lädt sie). */
  jobQueue: JobsServices;
  lesevertrag: DevicesReadContract;
}

/** Schlüssel und Freigaben liegen unter Zeilenschutz; geprüft wird, bevor die Anfrage ein Konto trägt. */
const WITHOUT_ACCOUNT = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';

export const zugang = (db: Db, l: DevicesReadContract) => ({
  geraeteSchluessel: {
    familyOfTokens: mit(l)(imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.familyOfTokens)),
    keyThe: imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.keyThe),
    entryThe: imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.entryThe),
    putKeyAn: mit(l)(imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.putKeyAn)),
    putNonceAn: mit(l)(imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.putNonceAn)),
    qrNonceThe: imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.qrNonceThe),
    takeNonce: imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.takeNonce),
    putChallengeAn: imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.putChallengeAn),
    takeChallenge: imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.takeChallenge),
    openRelease: imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.openRelease),
    useRelease: imSystem(db, WITHOUT_ACCOUNT, geraeteSchluessel.useRelease),
  },
});
export type DevicesContext = Kontext<DevicesDependencies, ReturnType<typeof zugang>>;
