/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeKonto bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as anmeldepruefung from './anmeldepruefung';
import * as anmeldungAblauf from './anmeldungAblauf';
import * as geheimnisAltbestand from './geheimnisAltbestand';
import * as geraeteChallenge from './geraeteChallenge';
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
import * as nutzerEinstellung from './nutzerEinstellung';
import * as einrichtungStand from './einrichtungStand';
import * as zielDrossel from './zielDrossel';
import * as passwortBestaetigung from './passwortBestaetigung';
import * as sitzungsVersion from './sitzungsVersion';
import * as indexHtml from './indexHtml';
import * as zweiterFaktorDienst from './zweiterFaktor';
import * as zugaengeDienst from './zugaenge';
import * as startVerwalterDienst from './startVerwalter';
import * as qrKopplungDienst from './qrKopplung';
import * as passkeysDienst from './passkeys';
import * as kontenDienst from './konten';
import { zugang, type KontoAbhaengigkeiten, type KontoKontext } from './kontext';

export type { KontoAbhaengigkeiten, KontoKontext } from './kontext';

export function erzeugeKonto(a: Omit<KontoAbhaengigkeiten, 'faecher'>, einblick?: Einblick<KontoKontext>) {
  const k: KontoKontext = baueKontext({ ...a, faecher: new Faecher() }, zugang);
  einblick?.(k);
  return {
    ...bindeZugang(k, anmeldepruefung, ['verifiziereEmailToken', 'pruefeAnmeldedaten']),
    ...bindeZugang(k, anmeldungAblauf, [
      'profilAendern',
      'eigenesPasswortAendern',
      'anmeldeAntwort',
      'geraeteTokenAusstellen',
      'qrZugangErzeugen',
    ]),
    ...bindeZugang(k, geheimnisAltbestand, ['verschluesseleAltbestand']),
    ...bindeZugang(k, geraeteChallenge, [
      'neueNonce',
      'hinterlegeSchluessel',
      'neueChallenge',
      'loeseEin',
      'pruefeFreigabe',
    ]),
    ...bindeZugang(k, geraeteToken, [
      'pruefeToken',
      'rotiereToken',
      'deleteToken',
      'purgeExpiredTokens',
      'validateToken',
    ]),
    ...bindeZugang(k, kontenDienst, [
      'andereSitzungenBeenden',
      'meldeUngueltigeAdressen',
      'meldeAusstehendeAdressen',
      'kontenListe',
      'profil',
      'kontoKurzVon',
      'kontoVollVon',
      'gibtKonto',
      'kontoAnzeigeName',
      'passwortWechselFaellig',
      'setzeFremdesPasswort',
      'setzePasswortZurueck',
      'passwortPerLinkSetzen',
      'raeumeOffeneRegistrierungenAuf',
      'legeKontoAn',
      'registriere',
      'setzeAktiv',
      'setzeVerwalterRolle',
    ]),
    ...bindeZugang(k, kontoEntfernen, ['kontoEntfernen']),
    ...bindeZugang(k, kontoHinweis, ['verwalterHinweisNebenher', 'hinweisNebenher', 'haushaltBeitreten']),
    ...bindeZugang(k, loginLimiter, ['raeumeAnmeldezaehlerAuf', 'zaehleAnfrage']),
    ...bindeZugang(k, passkeysDienst, [
      'registrierungsOptionen',
      'registrierungPruefen',
      'anmeldungPruefen',
      'passkeysDesKontos',
      'loeschePasskey',
      'anmeldeOptionen',
    ]),
    ...bindeZugang(k, qrKopplungDienst, [
      'meldeGeraet',
      'holeQrTokenAb',
      'verwirfAbholung',
      'kopplungsStand',
      'bestaetigeKopplung',
      'lehneKopplungAb',
    ]),
    ...bindeZugang(k, registrierungAblauf, [
      'registrierungVersuchen',
      'bestaetigungErneutAnfordern',
      'ruecksetzLinkAnfordern',
      'nameZuBestaetigung',
      'kontoZumRuecksetzLink',
    ]),
    ...bindeZugang(k, startVerwalterDienst, ['legeStartVerwalterAn']),
    ...bindeZugang(k, tokenCache, ['horcheAufTokenWiderruf', 'leereTokenCache']),
    ...bindeZugang(k, tokenWunsch, ['tokenAngaben']),
    ...verwalterwege(k),
    ...bindeZugang(k, verwalterProtokoll, ['verwalterAktionMerken', 'verwaltungsProtokoll']),
    ...bindeZugang(k, zugaengeDienst, ['zugaengeListe', 'zugangBeenden', 'andereZugaengeBeenden']),
    ...bindeZugang(k, zugangsende, ['beendeAndereZugaenge', 'begrenzeSitzungen']),
    ...bindeZugang(k, zweiterFaktorDienst, ['istAktiv', 'stand', 'beginneEinrichtung', 'schalteAb', 'erneuereCodes']),
    ...bindeZugang(k, nutzerEinstellung, ['setUserSetting', 'setzeEigenesDesign']),
    ...bindeZugang(k, einrichtungStand, ['einrichtungStand']),
    ...bindeZugang(k, zielDrossel, ['zielGedrosselt', 'kontoGedrosselt']),
    ...bindeZugang(k, passwortBestaetigung, [
      'bestaetigeEinrichtungGebremst',
      'pruefeBestaetigung',
      'pruefeCodeBestaetigung',
    ]),
    ...bindeZugang(k, sitzungsVersion, ['sitzungsVersionAusDb', 'aktuelleSitzungsVersion']),
    ...bindeZugang(k, indexHtml, ['renderIndexHtml', 'setzeGlobalesDesign']),
    ...ausDemZugang(k),
  };
}

function verwalterwege(k: KontoKontext) {
  return bindeZugang(k, verwalterAktionen, [
    'registrierungFreischalten',
    'zweitenFaktorEntfernen',
    'aktivSetzen',
    'verwalterRolleSetzen',
    'passwortDurchVerwalter',
    'faktorDurchVerwalter',
    'fuehreFaelligeUebernahmenAus',
    'uebernahmenAbbrechen',
  ]);
}

/** Was andere Schichten brauchen, ohne Repository oder Token-Hash zu sehen: die Wache
 * langer Ströme (http/zugangsWache.ts) ohne Zwischenspeicher, das Protokoll für die
 * Verwaltung, der Vergleich mit dem Zugang der Anfrage für die Routen. */
function ausDemZugang(k: KontoKontext) {
  return {
    gueltigerToken: k.zugaenge.gueltigerToken,
    protokolliere: k.protokoll.protokolliere,
    raeumeProtokollAuf: k.protokoll.raeumeProtokollAuf,
    eigenerZugang: geraeteToken.eigenerZugang,
  };
}

export type KontoDienste = ReturnType<typeof erzeugeKonto>;
