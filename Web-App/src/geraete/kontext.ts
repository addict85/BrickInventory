/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/konfig';
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import type { GeraeteLesevertrag } from './lesevertrag';
import type { AuftraegeDienste } from '../auftraege';
import * as geraeteSchluessel from './repository/geraeteSchluessel';

export interface GeraeteAbhaengigkeiten {
  konfig: Readonly<Konfig>;
  db: Db;
  /** Der Laufzustand hält die Widerrufsliste der Attestation (katalog/widerrufsliste.ts lädt sie). */
  auftraege: AuftraegeDienste;
  lesevertrag: GeraeteLesevertrag;
}

/** Schlüssel und Freigaben liegen unter Zeilenschutz; geprüft wird, bevor die Anfrage ein Konto trägt. */
const OHNE_KONTO = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';

export const zugang = (db: Db, l: GeraeteLesevertrag) => ({
  geraeteSchluessel: {
    familieDesTokens: mit(l)(imSystem(db, OHNE_KONTO, geraeteSchluessel.familieDesTokens)),
    schluesselDer: imSystem(db, OHNE_KONTO, geraeteSchluessel.schluesselDer),
    eintragDer: imSystem(db, OHNE_KONTO, geraeteSchluessel.eintragDer),
    legeSchluesselAn: mit(l)(imSystem(db, OHNE_KONTO, geraeteSchluessel.legeSchluesselAn)),
    legeNonceAn: mit(l)(imSystem(db, OHNE_KONTO, geraeteSchluessel.legeNonceAn)),
    qrNonceDer: imSystem(db, OHNE_KONTO, geraeteSchluessel.qrNonceDer),
    nimmNonce: imSystem(db, OHNE_KONTO, geraeteSchluessel.nimmNonce),
    legeChallengeAn: imSystem(db, OHNE_KONTO, geraeteSchluessel.legeChallengeAn),
    nimmChallenge: imSystem(db, OHNE_KONTO, geraeteSchluessel.nimmChallenge),
    oeffneFreigabe: imSystem(db, OHNE_KONTO, geraeteSchluessel.oeffneFreigabe),
    nutzeFreigabe: imSystem(db, OHNE_KONTO, geraeteSchluessel.nutzeFreigabe),
  },
});
export type GeraeteKontext = Kontext<GeraeteAbhaengigkeiten, ReturnType<typeof zugang>>;
