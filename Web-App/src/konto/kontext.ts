/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Konfig } from '../infra/konfig';
import type { Db } from '../../db/database';
import type { Faecher } from '../infra/zwischenspeicher';
import { imSystem, mit, type Kontext } from '../infra/bereich';
import * as einrichtung from './repository/einrichtung';
import * as konten from './repository/konten';
import * as protokoll from './repository/protokoll';
import * as qrKopplung from './repository/qrKopplung';
import * as startVerwalter from './repository/startVerwalter';
import * as uebernahmen from './repository/uebernahmen';
import * as zugaenge from './repository/zugaenge';
import type { SettingsServices } from '../settings';
import type { HaushaltDienste } from '../haushalt';
import type { AuftraegeDienste } from '../auftraege';
import type { MailServices } from '../mail';
import type { ThrottleServices } from '../throttle';
import type { GeraeteDienste } from '../geraete';
import type { FactorsServices } from '../factors';
import type { Uhr } from '../infra/uhr';

export interface KontoAbhaengigkeiten {
  uhr: Uhr;
  konfig: Readonly<Konfig>;
  db: Db;
  /** Zustand je Zugang (Token-Cache, Sitzungsversionen); erzeugeKonto legt sie an. */
  faecher: Faecher;
  einstellungen: SettingsServices;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  mail: MailServices;
  throttle: ThrottleServices;
  geraete: GeraeteDienste;
  factors: FactorsServices;
}

/** Zugangsdaten liegen unter Zeilenschutz (0112): Den Systemrahmen bekommt nur, wer ohne Konto
 * oder über alle Konten arbeitet; was ein Konto über sich selbst liest, läuft ohne ihn. */
const OHNE_KONTO = 'Anmeldung oder Token-Prüfung: Es gibt noch kein Konto, für das der Zeilenschutz gälte';
const ALLE_KONTEN = 'Aufräumen über alle Konten';
const FREMDES_KONTO = 'Verwaltung oder Passwort vergessen: ändert ein Konto, das die Anfrage nicht trägt';
const NUR_SYSTEMROLLE = 'Passwort-Hash oder Sitzungsspeicher: nur die Systemrolle darf sie lesen';
const UEBERNAHME = 'Verwalterübernahme: Verwalter und Ziel sind verschiedene Konten';
const ZUGANG = 'Passwort, Rechte, Adresse und Sitzungsversion schreibt nur die Systemrolle (0117)';
const ADRESSE = 'Adressen und Links liest nur die Systemrolle (0121)';
const ALLE_NAMEN = 'Fremde Konten: Die Laufzeitrolle sieht nur das eigene und den Haushalt (0121)';

/** Der Einrichtungsstand der Startseite: Konten überhaupt, und ob das Startpasswort noch gilt. */
const einrichtungszugang = (db: Db) => ({
  einrichtung: { kontenStand: imSystem(db, ALLE_NAMEN, einrichtung.kontenStand) },
});

/** Konten und Protokoll. */
const kontenzugang = (db: Db) => ({
  konten: {
    kontoKurz: imSystem(db, ALLE_NAMEN, konten.kontoKurz),
    kontoZumNamen: imSystem(db, OHNE_KONTO, konten.kontoZumNamen),
    kontoVoll: imSystem(db, ADRESSE, konten.kontoVoll),
    profilZeile: imSystem(db, ADRESSE, konten.profilZeile),
    nameVergeben: imSystem(db, ADRESSE, konten.nameVergeben),
    aendereNamen: mit(db)(konten.aendereNamen),
    aendereBenutzernamen: imSystem(db, ZUGANG, konten.aendereBenutzernamen),
    verwirfAusstehendeAdresse: imSystem(db, ZUGANG, konten.verwirfAusstehendeAdresse),
    merkeEmailNeu: imSystem(db, ZUGANG, konten.merkeEmailNeu),
    kontoZuEmailToken: imSystem(db, ADRESSE, konten.kontoZuEmailToken),
    uebernimmEmailNeu: imSystem(db, ZUGANG, konten.uebernimmEmailNeu),
    verwirfEmailNeu: imSystem(db, ZUGANG, konten.verwirfEmailNeu),
    nameZuEmailToken: imSystem(db, ADRESSE, konten.nameZuEmailToken),
    offeneRegistrierungen: imSystem(db, ADRESSE, konten.offeneRegistrierungen),
    schalteRegistrierungFrei: imSystem(db, ZUGANG, konten.schalteRegistrierungFrei),
    ausstehendOhneLink: imSystem(db, ADRESSE, konten.ausstehendOhneLink),
    alleKonten: imSystem(db, 'Verwaltung: liest alle Konten', konten.alleKonten),
    alleAdressen: imSystem(db, ADRESSE, konten.alleAdressen),
    aktiveVerwalter: imSystem(db, ADRESSE, konten.aktiveVerwalter),
    fuegeKontoEin: imSystem(db, ZUGANG, konten.fuegeKontoEin),
    setzeVerwalter: imSystem(db, ZUGANG, konten.setzeVerwalter),
    schreibeAktiv: imSystem(db, ZUGANG, konten.schreibeAktiv),
    setzePasswortHash: imSystem(db, ZUGANG, konten.setzePasswortHash),
    setzeEigenesPasswort: imSystem(db, ZUGANG, konten.setzeEigenesPasswort),
    kontoExistiert: imSystem(db, ALLE_NAMEN, konten.kontoExistiert),
    loescheKonto: imSystem(db, ZUGANG, konten.loescheKonto),
    loescheEigenesKonto: imSystem(db, ZUGANG, konten.loescheEigenesKonto),
    loescheOffeneRegistrierungen: imSystem(db, ZUGANG, konten.loescheOffeneRegistrierungen),
    kontoMitEmail: imSystem(db, ADRESSE, konten.kontoMitEmail),
    registriereKonto: imSystem(db, ZUGANG, konten.registriereKonto),
    aktivesKontoNachEmail: imSystem(db, ADRESSE, konten.aktivesKontoNachEmail),
    setzeRuecksetzTokenWennFrei: imSystem(db, ZUGANG, konten.setzeRuecksetzTokenWennFrei),
    erneuereEmailTokenWennFrei: imSystem(db, ZUGANG, konten.erneuereEmailTokenWennFrei),
    kontoNachRuecksetzToken: imSystem(db, ADRESSE, konten.kontoNachRuecksetzToken),
    setzePasswortNachRuecksetzen: imSystem(db, ZUGANG, konten.setzePasswortNachRuecksetzen),
    zugaengeDesKontos: mit(db)(konten.zugaengeDesKontos),
    tokenStand: imSystem(db, 'Token-Prüfung: sucht über den Hash, ohne Konto', konten.tokenStand),
    zugangLoeschen: mit(db)(konten.zugangLoeschen),
    andereZugaengeLoeschen: mit(db)(konten.andereZugaengeLoeschen),
    loescheAndereSitzungen: imSystem(db, NUR_SYSTEMROLLE, konten.loescheAndereSitzungen),
    mussPasswortAendern: mit(db)(konten.mussPasswortAendern),
  },
  protokoll: {
    protokolliere: imSystem(db, ALLE_NAMEN, protokoll.protokolliere),
    letzteEintraege: imSystem(db, ALLE_NAMEN, protokoll.letzteEintraege),
    raeumeProtokollAuf: imSystem(db, ALLE_KONTEN, protokoll.raeumeProtokollAuf),
  },
});

/** Kopplung, Startverwalter und Token. */
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
    zielZumAbbruch: imSystem(db, 'Abbruch-Link: Die Anfrage trägt kein Konto', uebernahmen.zielZumAbbruch),
    angekuendigte: imSystem(db, UEBERNAHME, uebernahmen.angekuendigte),
  },
  startVerwalter: {
    kontenVorhanden: imSystem(db, ALLE_NAMEN, startVerwalter.kontenVorhanden),
    startpasswortOffen: imSystem(db, ALLE_NAMEN, startVerwalter.startpasswortOffen),
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
    sitzungsVersion: imSystem(db, OHNE_KONTO, zugaenge.sitzungsVersion),
    zaehleSitzungsVersionHoch: imSystem(db, ZUGANG, zugaenge.zaehleSitzungsVersionHoch),
    ziehAltzeilenNach: imSystem(db, ALLE_KONTEN, zugaenge.ziehAltzeilenNach),
    loescheAbgelaufene: imSystem(db, ALLE_KONTEN, zugaenge.loescheAbgelaufene),
    loescheUngenutzte: imSystem(db, ALLE_KONTEN, zugaenge.loescheUngenutzte),
    kontoZurAnmeldung: imSystem(db, NUR_SYSTEMROLLE, zugaenge.kontoZurAnmeldung),
    passwortHash: imSystem(db, NUR_SYSTEMROLLE, zugaenge.passwortHash),
    ersetzePasswortHash: imSystem(db, NUR_SYSTEMROLLE, zugaenge.ersetzePasswortHash),
  },
});

export const zugang = (db: Db) => ({ ...einrichtungszugang(db), ...kontenzugang(db), ...sitzungszugang(db) });
export type KontoKontext = Kontext<KontoAbhaengigkeiten, ReturnType<typeof zugang>>;
