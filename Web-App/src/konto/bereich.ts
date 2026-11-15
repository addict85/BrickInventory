/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as anmeldepruefung from './anmeldepruefung';
import * as anmeldungAblauf from './anmeldungAblauf';
import * as geheimnisAltbestand from './geheimnisAltbestand';
import * as geraeteToken from './geraeteToken';
import * as kontoEntfernen from './kontoEntfernen';
import * as kontoHinweis from './kontoHinweis';
import * as loginLimiter from './loginLimiter';
import * as registrierungAblauf from './registrierungAblauf';
import * as tokenCache from './tokenCache';
import * as tokenWunsch from './tokenWunsch';
import * as verwalterAktionen from './verwalterAktionen';
import * as verwalterProtokoll from './verwalterProtokoll';
import * as zugangsende from './zugangsende';
import * as zielDrossel from './zielDrossel';
import * as passwortBestaetigung from './passwortBestaetigung';
import * as sitzungsVersion from './sitzungsVersion';
import * as zweiterFaktorDienst from './zweiterFaktor';
import * as zugaengeDienst from './zugaenge';
import * as startVerwalterDienst from './startVerwalter';
import * as qrKopplungDienst from './qrKopplung';
import * as passkeysDienst from './passkeys';
import * as kontenDienst from './konten';
import type { GeraeteDienste } from '../geraete';
import { zugang, type KontoAbhaengigkeiten, type KontoKontext } from './kontext';

export type { KontoAbhaengigkeiten, KontoKontext } from './kontext';

export function erzeugeKonto(a: Omit<KontoAbhaengigkeiten, 'faecher'>, einblick?: Einblick<KontoKontext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: KontoKontext) => ({ ...anmeldungUndGeraete(k), ...konten(k), ...verwaltung(k), ...ausDemZugang(k) }),
    einblick,
  );
}

/** Anmeldung, Geräte und Token. */
function anmeldungUndGeraete(k: KontoKontext) {
  return {
    verifiziereEmailToken: mit(k)(anmeldepruefung.verifiziereEmailToken),
    pruefeAnmeldedaten: mit(k)(anmeldepruefung.pruefeAnmeldedaten),
    eigenesPasswortAendern: mit(k)(anmeldungAblauf.eigenesPasswortAendern),
    anmeldeAntwort: mit(k)(anmeldungAblauf.anmeldeAntwort),
    geraeteTokenAusstellen: mit(k)(anmeldungAblauf.geraeteTokenAusstellen),
    qrZugangErzeugen: mit(k)(anmeldungAblauf.qrZugangErzeugen),
    verschluesseleAltbestand: mit(k)(geheimnisAltbestand.verschluesseleAltbestand),
    // Der Schrittschutz (http/schrittschutz.ts) fragt das Konto, ob die Anfrage darf; die Regel steht in geraete.
    pruefeFreigabe: (...a: Parameters<GeraeteDienste['pruefeFreigabe']>) => k.geraete.pruefeFreigabe(...a),
    pruefeToken: mit(k)(geraeteToken.pruefeToken),
    rotiereToken: mit(k)(geraeteToken.rotiereToken),
    tokenLoeschen: mit(k)(geraeteToken.tokenLoeschen),
    tokensAufraeumen: mit(k)(geraeteToken.tokensAufraeumen),
    nutzerZumToken: mit(k)(geraeteToken.nutzerZumToken),
  };
}

/** Konten, Zugänge, Verwaltung und Einstellungen des Kontos. */
function konten(k: KontoKontext) {
  return {
    andereSitzungenBeenden: mit(k)(kontenDienst.andereSitzungenBeenden),
    meldeUngueltigeAdressen: mit(k)(kontenDienst.meldeUngueltigeAdressen),
    meldeAusstehendeAdressen: mit(k)(kontenDienst.meldeAusstehendeAdressen),
    kontenListe: mit(k)(kontenDienst.kontenListe),
    profil: mit(k)(kontenDienst.profil),
    kontoKurzVon: mit(k)(kontenDienst.kontoKurzVon),
    kontoVollVon: mit(k)(kontenDienst.kontoVollVon),
    gibtKonto: mit(k)(kontenDienst.gibtKonto),
    kontoAnzeigeName: mit(k)(kontenDienst.kontoAnzeigeName),
    passwortWechselFaellig: mit(k)(kontenDienst.passwortWechselFaellig),
    setzeFremdesPasswort: mit(k)(kontenDienst.setzeFremdesPasswort),
    setzePasswortZurueck: mit(k)(kontenDienst.setzePasswortZurueck),
    passwortPerLinkSetzen: mit(k)(kontenDienst.passwortPerLinkSetzen),
    raeumeOffeneRegistrierungenAuf: mit(k)(kontenDienst.raeumeOffeneRegistrierungenAuf),
    legeKontoAn: mit(k)(kontenDienst.legeKontoAn),
    registriere: mit(k)(kontenDienst.registriere),
    setzeAktiv: mit(k)(kontenDienst.setzeAktiv),
    setzeVerwalterRolle: mit(k)(kontenDienst.setzeVerwalterRolle),
    kontoEntfernen: mit(k)(kontoEntfernen.kontoEntfernen),
    loescheKontoDateien: kontoEntfernen.loescheKontoDateien,
    verwalterHinweisNebenher: mit(k)(kontoHinweis.verwalterHinweisNebenher),
    hinweisNebenher: mit(k)(kontoHinweis.hinweisNebenher),
    haushaltBeitreten: mit(k)(kontoHinweis.haushaltBeitreten),
    raeumeAnmeldezaehlerAuf: mit(k)(loginLimiter.raeumeAnmeldezaehlerAuf),
    zaehleAnfrage: mit(k)(loginLimiter.zaehleAnfrage),
    registrierungsOptionen: mit(k)(passkeysDienst.registrierungsOptionen),
    registrierungPruefen: mit(k)(passkeysDienst.registrierungPruefen),
    anmeldungPruefen: mit(k)(passkeysDienst.anmeldungPruefen),
    passkeysDesKontos: mit(k)(passkeysDienst.passkeysDesKontos),
    loeschePasskey: mit(k)(passkeysDienst.loeschePasskey),
    anmeldeOptionen: mit(k)(passkeysDienst.anmeldeOptionen),
    meldeGeraet: mit(k)(qrKopplungDienst.meldeGeraet),
    holeQrTokenAb: mit(k)(qrKopplungDienst.holeQrTokenAb),
    verwirfAbholung: mit(k)(qrKopplungDienst.verwirfAbholung),
    kopplungsStand: mit(k)(qrKopplungDienst.kopplungsStand),
    bestaetigeKopplung: mit(k)(qrKopplungDienst.bestaetigeKopplung),
    lehneKopplungAb: mit(k)(qrKopplungDienst.lehneKopplungAb),
    registrierungVersuchen: mit(k)(registrierungAblauf.registrierungVersuchen),
    bestaetigungErneutAnfordern: mit(k)(registrierungAblauf.bestaetigungErneutAnfordern),
    ruecksetzLinkAnfordern: mit(k)(registrierungAblauf.ruecksetzLinkAnfordern),
    nameZuBestaetigung: mit(k)(registrierungAblauf.nameZuBestaetigung),
    kontoZumRuecksetzLink: mit(k)(registrierungAblauf.kontoZumRuecksetzLink),
    legeStartVerwalterAn: mit(k)(startVerwalterDienst.legeStartVerwalterAn),
    horcheAufTokenWiderruf: mit(k)(tokenCache.horcheAufTokenWiderruf),
    leereTokenCache: mit(k)(tokenCache.leereTokenCache),
    tokenAngaben: mit(k)(tokenWunsch.tokenAngaben),
    zugaengeListe: mit(k)(zugaengeDienst.zugaengeListe),
    zugangBeenden: mit(k)(zugaengeDienst.zugangBeenden),
    andereZugaengeBeenden: mit(k)(zugaengeDienst.andereZugaengeBeenden),
    beendeAndereZugaenge: mit(k)(zugangsende.beendeAndereZugaenge),
    begrenzeSitzungen: mit(k)(zugangsende.begrenzeSitzungen),
    istAktiv: mit(k)(zweiterFaktorDienst.istAktiv),
    stand: mit(k)(zweiterFaktorDienst.stand),
    beginneEinrichtung: mit(k)(zweiterFaktorDienst.beginneEinrichtung),
    otpauthFuer: mit(k)(zweiterFaktorDienst.otpauthFuer),
    schalteAb: mit(k)(zweiterFaktorDienst.schalteAb),
    erneuereCodes: mit(k)(zweiterFaktorDienst.erneuereCodes),
    zielGedrosselt: mit(k)(zielDrossel.zielGedrosselt),
    kontoGedrosselt: mit(k)(zielDrossel.kontoGedrosselt),
    bestaetigeEinrichtungGebremst: mit(k)(passwortBestaetigung.bestaetigeEinrichtungGebremst),
    pruefeBestaetigung: mit(k)(passwortBestaetigung.pruefeBestaetigung),
    pruefeCodeBestaetigung: mit(k)(passwortBestaetigung.pruefeCodeBestaetigung),
    sitzungsVersionAusDb: mit(k)(sitzungsVersion.sitzungsVersionAusDb),
    aktuelleSitzungsVersion: mit(k)(sitzungsVersion.aktuelleSitzungsVersion),
  };
}

/** Verwalter an fremden Konten: Änderungen, Übernahmen und ihr Protokoll. */
function verwaltung(k: KontoKontext) {
  return {
    registrierungFreischalten: mit(k)(verwalterAktionen.registrierungFreischalten),
    aktivSetzen: mit(k)(verwalterAktionen.aktivSetzen),
    verwalterRolleSetzen: mit(k)(verwalterAktionen.verwalterRolleSetzen),
    passwortDurchVerwalter: mit(k)(verwalterAktionen.passwortDurchVerwalter),
    faktorDurchVerwalter: mit(k)(verwalterAktionen.faktorDurchVerwalter),
    fuehreFaelligeUebernahmenAus: mit(k)(verwalterAktionen.fuehreFaelligeUebernahmenAus),
    uebernahmenAbbrechen: mit(k)(verwalterAktionen.uebernahmenAbbrechen),
    verwalterAktionMerken: mit(k)(verwalterProtokoll.verwalterAktionMerken),
    verwaltungsProtokoll: mit(k)(verwalterProtokoll.verwaltungsProtokoll),
  };
}

/** Was andere Schichten brauchen, ohne Repository oder Token-Hash zu sehen: Zugangswache,
 * Protokoll, Profil und Einrichtungsstand; users gehört dem Konto, geschrieben wird nur hier. */
function ausDemZugang(k: KontoKontext) {
  return {
    gueltigerToken: k.zugaenge.gueltigerToken,
    protokolliere: k.protokoll.protokolliere,
    raeumeProtokollAuf: k.protokoll.raeumeProtokollAuf,
    eigenerZugang: geraeteToken.eigenerZugang,
    nameVergeben: k.konten.nameVergeben,
    aendereBenutzernamen: k.konten.aendereBenutzernamen,
    aendereNamen: k.konten.aendereNamen,
    merkeEmailNeu: k.konten.merkeEmailNeu,
    kontoMitEmail: k.konten.kontoMitEmail,
    kontenStand: k.einrichtung.kontenStand,
    datenbankErreichbar: k.einrichtung.datenbankErreichbar,
  };
}

export type KontoDienste = ReturnType<typeof erzeugeKonto>;
