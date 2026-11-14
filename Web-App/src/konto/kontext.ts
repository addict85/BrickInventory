/** Was die Dienste des Bereichs bekommen: Zugang, Dienste tieferer Bereiche, Arbeitseinheit.
 * Getrennt von bereich.ts, damit ein Dienst seinen Typ ohne Importzyklus kennt. */
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/zwischenspeicher';
import { bindeJeFunktion, bindeZugang, type Kontext } from '../infra/bereich';
import * as altgeheimnisse from './repository/altgeheimnisse';
import * as anmeldezaehler from './repository/anmeldezaehler';
import * as einrichtung from './repository/einrichtung';
import * as geraeteSchluessel from './repository/geraeteSchluessel';
import * as konten from './repository/konten';
import * as passkeys from './repository/passkeys';
import * as protokoll from './repository/protokoll';
import * as qrKopplung from './repository/qrKopplung';
import * as startVerwalter from './repository/startVerwalter';
import * as zugaenge from './repository/zugaenge';
import * as zweiterFaktor from './repository/zweiterFaktor';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';
import type { MailDienste } from '../mail';

export interface KontoAbhaengigkeiten {
  db: Db;
  /** Zustand je Zugang (Token-Cache, Sitzungsversionen); erzeugeKonto legt sie an. */
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  nacharbeit: Nacharbeit;
  mail: MailDienste;
}

/** Zugangsdaten liegen unter Zeilenschutz (0112): Den Systemrahmen bekommt nur, wer ohne Konto
 * oder über alle Konten arbeitet; was ein Konto über sich selbst liest, läuft ohne ihn. */
const OHNE_KONTO = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';
const ALLE_KONTEN = 'Aufräumen über alle Konten';
const FREMDES_KONTO = 'Verwaltung oder Passwort vergessen: ändert ein Konto, das die Anfrage nicht trägt';
const NUR_SYSTEMROLLE = 'Passwort-Hash oder Sitzungsspeicher: nur die Systemrolle darf sie lesen';

export const zugang = (db: Db) => ({
  altgeheimnisse: bindeJeFunktion(db, altgeheimnisse, 'zugangsdaten', {
    alteFaktorGeheimnisse: 'Start: verschlüsselt die Geheimnisse aller Konten neu',
    ersetzeFaktorGeheimnis: 'Start: verschlüsselt die Geheimnisse aller Konten neu',
  }),
  anmeldezaehler: bindeZugang(db, anmeldezaehler, [
    'erhoehe',
    'gibLaufplatzFrei',
    'kontoZumNamen',
    'lies',
    'loescheZaehler',
    'loescheZaehlerMitPraefix',
    'raeumeAuf',
    'zaehleHoch',
  ]),
  einrichtung: bindeZugang(db, einrichtung),
  geraeteSchluessel: bindeJeFunktion(db, geraeteSchluessel, 'zugangsdaten', {
    familieDesTokens: OHNE_KONTO,
    schluesselDer: OHNE_KONTO,
    eintragDer: OHNE_KONTO,
    legeSchluesselAn: OHNE_KONTO,
    legeNonceAn: OHNE_KONTO,
    qrNonceDer: OHNE_KONTO,
    nimmNonce: OHNE_KONTO,
    legeChallengeAn: OHNE_KONTO,
    nimmChallenge: OHNE_KONTO,
    oeffneFreigabe: OHNE_KONTO,
    nutzeFreigabe: OHNE_KONTO,
  }),
  konten: bindeJeFunktion(db, konten, 'zugangsdaten', {
    alleKonten: 'Verwaltung: liest den zweiten Faktor aller Konten',
    loescheAndereSitzungen: NUR_SYSTEMROLLE,
    tokenStand: 'Token-Prüfung: sucht über den Hash, ohne Konto',
  }),
  passkeys: bindeJeFunktion(db, passkeys, 'zugangsdaten', {
    speichereChallenge: 'Anmeldeoptionen ohne Konto; die Obergrenze zählt alle offenen',
    verbraucheChallenge: OHNE_KONTO,
    schluessel: 'Anmeldung mit Passkey: Das Konto ergibt sich erst aus ihm',
    zaehlerWeiter: OHNE_KONTO,
    hatWelche: 'Anmeldeprüfung: fragt, bevor das Konto angemeldet ist',
    loescheAlleDesKontos: FREMDES_KONTO,
  }),
  protokoll: bindeZugang(db, protokoll),
  qrKopplung: bindeJeFunktion(db, qrKopplung, 'zugangsdaten', {
    raeumeQrKopplungenAuf: ALLE_KONTEN,
    legeQrKopplungAn: 'Das Gerät ohne Konto legt die Kopplung an',
    melde: OHNE_KONTO,
    nachAbholung: OHNE_KONTO,
    markiereAbgeholt: OHNE_KONTO,
    markiereBestaetigt: 'Die Zeile trägt das Konto erst mit der Bestätigung',
    zaehleQrFehlversuch: 'wie markiereBestaetigt',
    markiereAbgelehnt: 'Auch das Gerät ohne Konto lehnt ab',
  }),
  startVerwalter: bindeZugang(db, startVerwalter),
  zugaenge: bindeJeFunktion(db, zugaenge, 'zugangsdaten', {
    beendeUeberlappung: OHNE_KONTO,
    beruehreToken: OHNE_KONTO,
    gueltigerToken: OHNE_KONTO,
    ersetzePasswortHash: NUR_SYSTEMROLLE,
    kappeSitzungen: NUR_SYSTEMROLLE,
    kappeTokens: 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto',
    kontoZurAnmeldung: NUR_SYSTEMROLLE,
    loescheSitzungenDesKontos: NUR_SYSTEMROLLE,
    passwortHash: NUR_SYSTEMROLLE,
    legeTokenAn: 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto',
    loescheAbgelaufene: ALLE_KONTEN,
    loescheToken: 'Abmelden mit einem Token, dessen Konto die Anfrage nicht mehr trägt',
    loescheTokensDesKontos: FREMDES_KONTO,
    loescheUngenutzte: ALLE_KONTEN,
    loescheVerwaisteVerbrauchte: ALLE_KONTEN,
    sperreFamilie: OHNE_KONTO,
    ziehAltzeilenNach: ALLE_KONTEN,
  }),
  zweiterFaktor: bindeJeFunktion(db, zweiterFaktor, 'zugangsdaten', {
    aktiv: 'Anmeldeprüfung: fragt, bevor das Konto angemeldet ist',
    aktivesGeheimnis: 'Anmeldung: prüft den Code, bevor das Konto angemeldet ist',
    entferne: FREMDES_KONTO,
    verbraucheCode: 'Anmeldung: prüft den Code, bevor das Konto angemeldet ist',
    verbraucheSchritt: 'Anmeldung: prüft den Code, bevor das Konto angemeldet ist',
  }),
});
export type KontoKontext = Kontext<KontoAbhaengigkeiten, ReturnType<typeof zugang>>;
