/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeBestand bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeGenerisch, bindeZugang } from '../infra/bereich';
import * as acquisitions from './acquisitions';
import * as bestandExportDienst from './bestandExport';
import * as gemeinsamDienst from './gemeinsam';
import * as kennzahlenDienst from './kennzahlen';
import * as manuelleMenge from './manuelleMenge';
import * as papierkorbDienst from './papierkorb';
import * as kaufpreisNachtrag from './kaufpreisNachtrag';
import * as lagerortRechte from './lagerortRechte';
import { zugang, type BestandAbhaengigkeiten, type BestandKontext } from './kontext';

export type { BestandAbhaengigkeiten, BestandKontext } from './kontext';

export function erzeugeBestand(a: BestandAbhaengigkeiten) {
  const k: BestandKontext = baueKontext(a, zugang);
  return {
    ...k,
    ...bindeZugang(k, acquisitions, ['recordAcquisitionForDay', 'findSameDayAcquisition', 'setzeGeschaetztenPreis']),
    erfassungenInKontowaehrung: bindeGenerisch(k)(acquisitions.erfassungenInKontowaehrung),
    ...bindeZugang(k, bestandExportDienst, ['buildPartsCsv', 'buildFigsCsv']),
    ...bindeZugang(k, gemeinsamDienst, ['verwendendeSets']),
    applyManualCondition: bindeGenerisch(k)(gemeinsamDienst.applyManualCondition),
    ...bindeZugang(k, kennzahlenDienst, ['getStats']),
    ...bindeZugang(k, manuelleMenge, ['passeManuelleMengeAn']),
    ...bindeZugang(k, papierkorbDienst, [
      'listePapierkorb',
      'stelleWiederHer',
      'loescheEndgueltig',
      'leerePapierkorb',
      'raeumePapierkorbAuf',
    ]),
    ...bindeZugang(k, kaufpreisNachtrag, ['run']),
    ...bindeZugang(k, lagerortRechte, ['setzeVorgabe', 'lagerSchreibkonto', 'orteFuer']),
  };
}

export type BestandDienste = ReturnType<typeof erzeugeBestand>;
