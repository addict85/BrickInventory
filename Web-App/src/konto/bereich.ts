/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as anmeldepruefung from './anmeldepruefung';
import * as anmeldungAblauf from './anmeldungAblauf';
import * as geraeteToken from './geraeteToken';
import * as kontoEntfernen from './kontoEntfernen';
import { kontoAuftragsarten } from './auftragsarten';
import * as kontoHinweis from './kontoHinweis';
import * as nebenlaeufe from './nebenlaeufe';
import * as profilAendern from './profilAendern';
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
import * as zugaengeDienst from './zugaenge';
import * as startVerwalterDienst from './startVerwalter';
import * as qrKopplungDienst from './qrKopplung';
import * as kontenDienst from './konten';
import type { GeraeteDienste } from '../geraete';
import { zugang, type KontoAbhaengigkeiten, type KontoKontext } from './kontext';

export type { KontoAbhaengigkeiten, KontoKontext } from './kontext';

export function erzeugeKonto(a: Omit<KontoAbhaengigkeiten, 'faecher'>, einblick?: Einblick<KontoKontext>) {
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: KontoKontext) => ({
      ...anmeldungUndGeraete(k),
      ...konten(k),
      verwalter: verwaltung(k),
      sitzungen: sitzungen(k),
    }),
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
    // Der Schrittschutz (http/schrittschutz.ts) fragt das Konto, ob die Anfrage darf; die Regel steht in geraete.
    pruefeFreigabe: (...a: Parameters<GeraeteDienste['pruefeFreigabe']>) => k.geraete.pruefeFreigabe(...a),
    pruefeToken: mit(k)(geraeteToken.pruefeToken),
    rotiereToken: mit(k)(geraeteToken.rotiereToken),
    tokenLoeschen: mit(k)(geraeteToken.tokenLoeschen),
    nutzerZumToken: mit(k)(geraeteToken.nutzerZumToken),
    tokenGilt: mit(k)(geraeteToken.tokenGilt),
  };
}

/** Konten, Zugänge, Verwaltung und Einstellungen des Kontos. */
function konten(k: KontoKontext) {
  return {
    aufraeumSchritte: mit(k)(nebenlaeufe.aufraeumSchritte),
    adressHinweise: mit(k)(nebenlaeufe.adressHinweise),
    kontenListe: mit(k)(kontenDienst.kontenListe),
    profil: mit(k)(kontenDienst.profil),
    profilAendern: mit(k)(profilAendern.profilAendern),
    kontoKurzVon: mit(k)(kontenDienst.kontoKurzVon),
    kontoVollVon: mit(k)(kontenDienst.kontoVollVon),
    gibtKonto: mit(k)(kontenDienst.gibtKonto),
    kontoAnzeigeName: mit(k)(kontenDienst.kontoAnzeigeName),
    passwortWechselFaellig: mit(k)(kontenDienst.passwortWechselFaellig),
    kontoEingerichtet: mit(k)(kontenDienst.kontoEingerichtet),
    faktorPflichtOffen: mit(k)(kontenDienst.faktorPflichtOffen),
    passwortPerLinkSetzen: mit(k)(kontenDienst.passwortPerLinkSetzen),
    legeKontoAn: mit(k)(kontenDienst.legeKontoAn),
    kontoEntfernen: mit(k)(kontoEntfernen.kontoEntfernen),
    auftragsarten: kontoAuftragsarten,
    verwalterHinweisNebenher: mit(k)(kontoHinweis.verwalterHinweisNebenher),
    hinweisNebenher: mit(k)(kontoHinweis.hinweisNebenher),
    haushaltBeitreten: mit(k)(kontoHinweis.haushaltBeitreten),
    zaehleAnfrage: mit(k)(loginLimiter.zaehleAnfrage),
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
    horcheAufSitzungsVersion: mit(k)(sitzungsVersion.horcheAufSitzungsVersion),
    tokenAngaben: mit(k)(tokenWunsch.tokenAngaben),
    zielGedrosselt: mit(k)(zielDrossel.zielGedrosselt),
    kontoGedrosselt: mit(k)(zielDrossel.kontoGedrosselt),
    bestaetigeEinrichtungGebremst: mit(k)(passwortBestaetigung.bestaetigeEinrichtungGebremst),
    pruefeBestaetigung: mit(k)(passwortBestaetigung.pruefeBestaetigung),
    pruefeCodeBestaetigung: mit(k)(passwortBestaetigung.pruefeCodeBestaetigung),
  };
}

/** Sitzungen und App-Zugänge des eigenen Kontos. */
function sitzungen(k: KontoKontext) {
  return {
    zugaengeListe: mit(k)(zugaengeDienst.zugaengeListe),
    zugangBeenden: mit(k)(zugaengeDienst.zugangBeenden),
    beendeAndere: mit(k)(zugangsende.beendeAndere),
    begrenze: mit(k)(zugangsende.begrenzeSitzungen),
    versionAusDb: mit(k)(sitzungsVersion.sitzungsVersionAusDb),
    aktuelleVersion: mit(k)(sitzungsVersion.aktuelleSitzungsVersion),
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
    uebernahmenAbbrechen: mit(k)(verwalterAktionen.uebernahmenAbbrechen),
    verwalterAktionMerken: mit(k)(verwalterProtokoll.verwalterAktionMerken),
    verwaltungsProtokoll: mit(k)(verwalterProtokoll.verwaltungsProtokoll),
  };
}

export type KontoDienste = ReturnType<typeof erzeugeKonto>;
