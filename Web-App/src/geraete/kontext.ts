/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/konfig';
import type { Uhr } from '../infra/uhr';
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import type { DevicesReadContract } from './lesevertrag';
import type { JobsServices } from '../auftraege';
import * as geraeteSchluessel from './repository/geraeteSchluessel';

export interface DevicesDependencies {
  konfig: Readonly<Konfig>;
  db: Db;
  uhr: Uhr;
  /** Der Laufzustand hält die Widerrufsliste der Attestation (katalog/widerrufsliste.ts lädt sie). */
  auftraege: JobsServices;
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
