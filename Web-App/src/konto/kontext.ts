/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/konfig';
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/zwischenspeicher';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import * as altgeheimnisse from './repository/altgeheimnisse';
import * as einrichtung from './repository/einrichtung';
import * as konten from './repository/konten';
import * as passkeys from './repository/passkeys';
import * as protokoll from './repository/protokoll';
import * as qrKopplung from './repository/qrKopplung';
import * as startVerwalter from './repository/startVerwalter';
import * as uebernahmen from './repository/uebernahmen';
import * as zugaenge from './repository/zugaenge';
import * as zweiterFaktor from './repository/zweiterFaktor';
import type { EinstellungenDienste } from '../einstellungen';
import type { HaushaltDienste } from '../haushalt';
import type { AuftraegeDienste, Nacharbeit } from '../auftraege';
import type { MailDienste } from '../mail';
import type { DrosselDienste } from '../drossel';
import type { GeraeteDienste } from '../geraete';

export interface KontoAbhaengigkeiten {
  konfig: Readonly<Konfig>;
  db: Db;
  /** Zustand je Zugang (Token-Cache, Sitzungsversionen); erzeugeKonto legt sie an. */
  faecher: Faecher;
  einstellungen: EinstellungenDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  nacharbeit: Nacharbeit;
  mail: MailDienste;
  drossel: DrosselDienste;
  geraete: GeraeteDienste;
}

/** Zugangsdaten liegen unter Zeilenschutz (0112): Den Systemrahmen bekommt nur, wer ohne Konto
 * oder über alle Konten arbeitet; was ein Konto über sich selbst liest, läuft ohne ihn. */
const OHNE_KONTO = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';
const ALLE_KONTEN = 'Aufräumen über alle Konten';
const FREMDES_KONTO = 'Verwaltung oder Passwort vergessen: ändert ein Konto, das die Anfrage nicht trägt';
const NUR_SYSTEMROLLE = 'Passwort-Hash oder Sitzungsspeicher: nur die Systemrolle darf sie lesen';
const UEBERNAHME = 'Verwalterübernahme: Verwalter und Ziel sind verschiedene Konten';
const ZUGANG = 'Passwort, Rechte, Adresse und Sitzungsversion schreibt nur die Systemrolle (0117)';

/** Anmeldung ohne Konto: Zähler, Schlüssel und Geheimnisse der Geräte. */
const anmeldezugang = (db: Db) => ({
  altgeheimnisse: {
    alteFaktorGeheimnisse: imSystem(
      db,
      'Start: verschlüsselt die Geheimnisse aller Konten neu',
      altgeheimnisse.alteFaktorGeheimnisse,
    ),
    ersetzeFaktorGeheimnis: imSystem(
      db,
      'Start: verschlüsselt die Geheimnisse aller Konten neu',
      altgeheimnisse.ersetzeFaktorGeheimnis,
    ),
  },
  einrichtung: {
    kontenStand: mit(db)(einrichtung.kontenStand),
    datenbankErreichbar: mit(db)(einrichtung.datenbankErreichbar),
  },
});

/** Konten, Passkeys und Protokoll. */
const kontenzugang = (db: Db) => ({
  konten: {
    kontoKurz: mit(db)(konten.kontoKurz),
    kontoZumNamen: mit(db)(konten.kontoZumNamen),
    kontoVoll: mit(db)(konten.kontoVoll),
    profilZeile: mit(db)(konten.profilZeile),
    nameVergeben: mit(db)(konten.nameVergeben),
    aendereNamen: mit(db)(konten.aendereNamen),
    aendereBenutzernamen: imSystem(db, ZUGANG, konten.aendereBenutzernamen),
    verwirfAusstehendeAdresse: imSystem(db, ZUGANG, konten.verwirfAusstehendeAdresse),
    merkeEmailNeu: imSystem(db, ZUGANG, konten.merkeEmailNeu),
    kontoZuEmailToken: mit(db)(konten.kontoZuEmailToken),
    uebernimmEmailNeu: imSystem(db, ZUGANG, konten.uebernimmEmailNeu),
    verwirfEmailNeu: imSystem(db, ZUGANG, konten.verwirfEmailNeu),
    nameZuEmailToken: mit(db)(konten.nameZuEmailToken),
    offeneRegistrierungen: mit(db)(konten.offeneRegistrierungen),
    schalteRegistrierungFrei: imSystem(db, ZUGANG, konten.schalteRegistrierungFrei),
    ausstehendOhneLink: mit(db)(konten.ausstehendOhneLink),
    alleKonten: imSystem(db, 'Verwaltung: liest den zweiten Faktor aller Konten', konten.alleKonten),
    alleAdressen: mit(db)(konten.alleAdressen),
    aktiveVerwalter: mit(db)(konten.aktiveVerwalter),
    fuegeKontoEin: imSystem(db, ZUGANG, konten.fuegeKontoEin),
    setzeVerwalter: imSystem(db, ZUGANG, konten.setzeVerwalter),
    schreibeAktiv: imSystem(db, ZUGANG, konten.schreibeAktiv),
    setzePasswortHash: imSystem(db, ZUGANG, konten.setzePasswortHash),
    setzeEigenesPasswort: imSystem(db, ZUGANG, konten.setzeEigenesPasswort),
    kontoExistiert: mit(db)(konten.kontoExistiert),
    loescheKonto: imSystem(db, ZUGANG, konten.loescheKonto),
    loescheEigenesKonto: imSystem(db, ZUGANG, konten.loescheEigenesKonto),
    loescheOffeneRegistrierungen: imSystem(db, ZUGANG, konten.loescheOffeneRegistrierungen),
    kontoMitEmail: mit(db)(konten.kontoMitEmail),
    registriereKonto: imSystem(db, ZUGANG, konten.registriereKonto),
    aktivesKontoNachEmail: mit(db)(konten.aktivesKontoNachEmail),
    setzeRuecksetzTokenWennFrei: imSystem(db, ZUGANG, konten.setzeRuecksetzTokenWennFrei),
    erneuereEmailTokenWennFrei: imSystem(db, ZUGANG, konten.erneuereEmailTokenWennFrei),
    kontoNachRuecksetzToken: mit(db)(konten.kontoNachRuecksetzToken),
    setzePasswortNachRuecksetzen: imSystem(db, ZUGANG, konten.setzePasswortNachRuecksetzen),
    zugaengeDesKontos: mit(db)(konten.zugaengeDesKontos),
    tokenStand: imSystem(db, 'Token-Prüfung: sucht über den Hash, ohne Konto', konten.tokenStand),
    zugangLoeschen: mit(db)(konten.zugangLoeschen),
    andereZugaengeLoeschen: mit(db)(konten.andereZugaengeLoeschen),
    loescheAndereSitzungen: imSystem(db, NUR_SYSTEMROLLE, konten.loescheAndereSitzungen),
    mussPasswortAendern: mit(db)(konten.mussPasswortAendern),
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
    hatWelche: imSystem(db, 'Anmeldeprüfung: fragt, bevor das Konto angemeldet ist', passkeys.hatWelche),
    loescheAlleDesKontos: imSystem(db, FREMDES_KONTO, passkeys.loescheAlleDesKontos),
    loeschePasskeyZeile: mit(db)(passkeys.loeschePasskeyZeile),
  },
  protokoll: {
    protokolliere: mit(db)(protokoll.protokolliere),
    letzteEintraege: mit(db)(protokoll.letzteEintraege),
    raeumeProtokollAuf: imSystem(db, ALLE_KONTEN, protokoll.raeumeProtokollAuf),
  },
});

/** Kopplung, Startverwalter, Token und zweiter Faktor. */
const sitzungszugang = (db: Db) => ({
  qrKopplung: {
    raeumeQrKopplungenAuf: imSystem(db, ALLE_KONTEN, qrKopplung.raeumeQrKopplungenAuf),
    legeQrKopplungAn: imSystem(db, 'Das Gerät ohne Konto legt die Kopplung an', qrKopplung.legeQrKopplungAn),
    melde: imSystem(db, OHNE_KONTO, qrKopplung.melde),
    nachAbholung: imSystem(db, OHNE_KONTO, qrKopplung.nachAbholung),
    qrKopplungDesKontos: mit(db)(qrKopplung.qrKopplungDesKontos),
    markiereAbgeholt: imSystem(db, OHNE_KONTO, qrKopplung.markiereAbgeholt),
    markiereBestaetigt: imSystem(
      db,
      'Die Zeile trägt das Konto erst mit der Bestätigung',
      qrKopplung.markiereBestaetigt,
    ),
    zaehleQrFehlversuch: imSystem(db, 'wie markiereBestaetigt', qrKopplung.zaehleQrFehlversuch),
    markiereAbgelehnt: imSystem(db, 'Auch das Gerät ohne Konto lehnt ab', qrKopplung.markiereAbgelehnt),
  },
  uebernahmen: {
    kuendigeAn: imSystem(db, UEBERNAHME, uebernahmen.kuendigeAn),
    verwalterOderEbenGewesen: imSystem(db, UEBERNAHME, uebernahmen.verwalterOderEbenGewesen),
    nimmFaellige: imSystem(db, UEBERNAHME, uebernahmen.nimmFaellige),
    brichUebernahmenAb: imSystem(db, UEBERNAHME, uebernahmen.brichUebernahmenAb),
  },
  startVerwalter: {
    kontenVorhanden: mit(db)(startVerwalter.kontenVorhanden),
    startpasswortOffen: mit(db)(startVerwalter.startpasswortOffen),
    legeVerwalterAn: imSystem(db, ZUGANG, startVerwalter.legeVerwalterAn),
  },
  zugaenge: {
    gueltigerToken: imSystem(db, OHNE_KONTO, zugaenge.gueltigerToken),
    beendeUeberlappung: imSystem(db, OHNE_KONTO, zugaenge.beendeUeberlappung),
    beruehreToken: imSystem(db, OHNE_KONTO, zugaenge.beruehreToken),
    legeTokenAn: imSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', zugaenge.legeTokenAn),
    tauschQuelleSperren: mit(db)(zugaenge.tauschQuelleSperren),
    unbenutzterNachfolger: mit(db)(zugaenge.unbenutzterNachfolger),
    loescheFamilie: mit(db)(zugaenge.loescheFamilie),
    loescheUnbenutztenNachfolger: mit(db)(zugaenge.loescheUnbenutztenNachfolger),
    legeNachfolgerAn: mit(db)(zugaenge.legeNachfolgerAn),
    befristeVorgaenger: mit(db)(zugaenge.befristeVorgaenger),
    sperreFamilie: imSystem(db, OHNE_KONTO, zugaenge.sperreFamilie),
    loescheVerwaisteVerbrauchte: imSystem(db, ALLE_KONTEN, zugaenge.loescheVerwaisteVerbrauchte),
    loescheToken: imSystem(
      db,
      'Abmelden mit einem Token, dessen Konto die Anfrage nicht mehr trägt',
      zugaenge.loescheToken,
    ),
    loescheTokensDesKontos: imSystem(db, FREMDES_KONTO, zugaenge.loescheTokensDesKontos),
    kappeSitzungen: imSystem(db, NUR_SYSTEMROLLE, zugaenge.kappeSitzungen),
    kappeTokens: imSystem(db, 'Anmeldung: Die Sitzung des neuen Tokens trägt noch kein Konto', zugaenge.kappeTokens),
    loescheSitzungenDesKontos: imSystem(db, NUR_SYSTEMROLLE, zugaenge.loescheSitzungenDesKontos),
    sitzungsVersion: mit(db)(zugaenge.sitzungsVersion),
    zaehleSitzungsVersionHoch: imSystem(db, ZUGANG, zugaenge.zaehleSitzungsVersionHoch),
    ziehAltzeilenNach: imSystem(db, ALLE_KONTEN, zugaenge.ziehAltzeilenNach),
    loescheAbgelaufene: imSystem(db, ALLE_KONTEN, zugaenge.loescheAbgelaufene),
    loescheUngenutzte: imSystem(db, ALLE_KONTEN, zugaenge.loescheUngenutzte),
    kontoZurAnmeldung: imSystem(db, NUR_SYSTEMROLLE, zugaenge.kontoZurAnmeldung),
    passwortHash: imSystem(db, NUR_SYSTEMROLLE, zugaenge.passwortHash),
    ersetzePasswortHash: imSystem(db, NUR_SYSTEMROLLE, zugaenge.ersetzePasswortHash),
  },
  zweiterFaktor: {
    ersetzeCodes: mit(db)(zweiterFaktor.ersetzeCodes),
    aktiv: imSystem(db, 'Anmeldeprüfung: fragt, bevor das Konto angemeldet ist', zweiterFaktor.aktiv),
    faktorStand: mit(db)(zweiterFaktor.faktorStand),
    legeGeheimnisAn: mit(db)(zweiterFaktor.legeGeheimnisAn),
    unbestaetigtesGeheimnisSperren: mit(db)(zweiterFaktor.unbestaetigtesGeheimnisSperren),
    aktiviere: mit(db)(zweiterFaktor.aktiviere),
    aktivesGeheimnis: imSystem(
      db,
      'Anmeldung: prüft den Code, bevor das Konto angemeldet ist',
      zweiterFaktor.aktivesGeheimnis,
    ),
    verbraucheSchritt: imSystem(
      db,
      'Anmeldung: prüft den Code, bevor das Konto angemeldet ist',
      zweiterFaktor.verbraucheSchritt,
    ),
    verbraucheCode: imSystem(
      db,
      'Anmeldung: prüft den Code, bevor das Konto angemeldet ist',
      zweiterFaktor.verbraucheCode,
    ),
    entferne: imSystem(db, FREMDES_KONTO, zweiterFaktor.entferne),
  },
});

export const zugang = (db: Db) => ({ ...anmeldezugang(db), ...kontenzugang(db), ...sitzungszugang(db) });
export type KontoKontext = Kontext<KontoAbhaengigkeiten, ReturnType<typeof zugang>>;
