/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/konfig';
import type { Db } from '../../db/database';
import type { Uhr } from '../infra/uhr';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import type { EinstellungenDienste } from '../einstellungen';
import * as altgeheimnisse from './repository/altgeheimnisse';
import * as passkeys from './repository/passkeys';
import * as zweiterFaktor from './repository/zweiterFaktor';

export interface FaktorenAbhaengigkeiten {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  db: Db;
  /** Der Start verschlüsselt die globalen Altwerte im selben Lauf wie die Faktorgeheimnisse. */
  einstellungen: EinstellungenDienste;
}

/** Faktoren liegen unter Zeilenschutz (0112): Den Systemrahmen bekommt nur, wer vor der
 * Anmeldung oder an einem fremden Konto prüft; das eigene Konto liest ohne ihn. */
const OHNE_KONTO = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';
const FREMDES_KONTO = 'Verwaltung oder Passwort vergessen: ändert ein Konto, das die Anfrage nicht trägt';
const VOR_ANMELDUNG = 'Anmeldeprüfung: fragt, bevor das Konto angemeldet ist';
const CODE_VOR_ANMELDUNG = 'Anmeldung: prüft den Code, bevor das Konto angemeldet ist';
const NEU_VERSCHLUESSELN = 'Start: verschlüsselt die Geheimnisse aller Konten neu';

export const zugang = (db: Db) => ({
  altgeheimnisse: {
    alteFaktorGeheimnisse: imSystem(db, NEU_VERSCHLUESSELN, altgeheimnisse.alteFaktorGeheimnisse),
    ersetzeFaktorGeheimnis: imSystem(db, NEU_VERSCHLUESSELN, altgeheimnisse.ersetzeFaktorGeheimnis),
  },
  passkeys: {
    speichereChallenge: imSystem(
      db,
      'Anmeldeoptionen ohne Konto; die Obergrenze zählt alle offenen',
      passkeys.speichereChallenge,
    ),
    verbraucheChallenge: imSystem(db, OHNE_KONTO, passkeys.verbraucheChallenge),
    kennungenDesKontos: mit(db)(passkeys.kennungenDesKontos),
    legeAn: mit(db)(passkeys.legeAn),
    schluessel: imSystem(db, 'Anmeldung mit Passkey: Das Konto ergibt sich erst aus ihm', passkeys.schluessel),
    zaehlerWeiter: imSystem(db, OHNE_KONTO, passkeys.zaehlerWeiter),
    desKontos: mit(db)(passkeys.desKontos),
    hatWelche: imSystem(db, VOR_ANMELDUNG, passkeys.hatWelche),
    loescheAlleDesKontos: imSystem(db, FREMDES_KONTO, passkeys.loescheAlleDesKontos),
    loeschePasskeyZeile: mit(db)(passkeys.loeschePasskeyZeile),
  },
  zweiterFaktor: {
    ersetzeCodes: mit(db)(zweiterFaktor.ersetzeCodes),
    aktiv: imSystem(db, VOR_ANMELDUNG, zweiterFaktor.aktiv),
    aktiveUnter: imSystem(db, 'Verwaltung: liest den zweiten Faktor aller Konten', zweiterFaktor.aktiveUnter),
    faktorStand: mit(db)(zweiterFaktor.faktorStand),
    legeGeheimnisAn: mit(db)(zweiterFaktor.legeGeheimnisAn),
    unbestaetigtesGeheimnisSperren: mit(db)(zweiterFaktor.unbestaetigtesGeheimnisSperren),
    aktiviere: mit(db)(zweiterFaktor.aktiviere),
    aktivesGeheimnis: imSystem(db, CODE_VOR_ANMELDUNG, zweiterFaktor.aktivesGeheimnis),
    verbraucheSchritt: imSystem(db, CODE_VOR_ANMELDUNG, zweiterFaktor.verbraucheSchritt),
    verbraucheCode: imSystem(db, CODE_VOR_ANMELDUNG, zweiterFaktor.verbraucheCode),
    entferne: imSystem(db, FREMDES_KONTO, zweiterFaktor.entferne),
  },
});
export type FaktorenKontext = Kontext<FaktorenAbhaengigkeiten, ReturnType<typeof zugang>>;
