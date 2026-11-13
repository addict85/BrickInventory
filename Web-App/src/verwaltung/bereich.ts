/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeVerwaltung bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeZugang } from '../infra/bereich';
import * as aufraeumen from './aufraeumen';
import * as datenexport from './datenexport';
import * as diagnose from './diagnose';
import * as dienst from './dienst';
import * as gesundheit from './gesundheit';
import * as jobUebersicht from './jobUebersicht';
import * as einstellungenSpeichern from './einstellungenSpeichern';
import * as hintergrund from './hintergrund';
import * as startNachlaeufe from './startNachlaeufe';
import { zugang, type VerwaltungAbhaengigkeiten, type VerwaltungKontext } from './kontext';

export type { VerwaltungAbhaengigkeiten, VerwaltungKontext } from './kontext';

export function erzeugeVerwaltung(a: VerwaltungAbhaengigkeiten) {
  const k: VerwaltungKontext = baueKontext(a, zugang);
  return {
    ...k,
    ...bindeZugang(k, aufraeumen, ['aufraeumen', 'aufraeumenTaeglich']),
    ...bindeZugang(k, datenexport, ['datenZip', 'konfigImport', 'konfigExport']),
    ...bindeZugang(k, diagnose, ['preisProbe', 'bildDiagnose']),
    ...bindeZugang(k, dienst, [
      'cacheStatistik',
      'anleitungenNeuEinreihen',
      'preisJobStand',
      'katalogBilderEinreihen',
      'bildFehlanzeigenVergessen',
      'serverProtokollSeit',
      'cachesLeeren',
      'bricksetLimitGesetzt',
      'preisJobJetzt',
      'fehlendeBilderNachladen',
      'katalogAbgleichJetzt',
      'bricksetWiederholen',
      'bricksetEntfernen',
      'jobZeitplanSetzen',
    ]),
    ...bindeZugang(k, gesundheit, ['gesundheitsBericht', 'datenbankBereit']),
    ...bindeZugang(k, jobUebersicht, ['jobUebersicht']),
    ...bindeZugang(k, einstellungenSpeichern, ['einstellungenSpeichern']),
    ...bindeZugang(k, hintergrund, ['auftragsUebersicht', 'auftragsArtLeeren']),
    ...bindeZugang(k, startNachlaeufe, ['nachlauf']),
  };
}

export type VerwaltungDienste = ReturnType<typeof erzeugeVerwaltung>;
