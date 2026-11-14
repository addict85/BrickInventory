/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext (kontext.ts) als ersten
 * Parameter; erzeugeBestand bindet ihn einmal für alle. So greift kein Dienst auf den
 * Prozess zu, und ein Test gibt einen eigenen Zugang. */
import { baueKontext, bindeGenerisch, bindeZugang, type Einblick } from '../infra/bereich';
import * as acquisitions from './acquisitions';
import * as bestandExportDienst from './bestandExport';
import * as gemeinsamDienst from './gemeinsam';
import * as kennzahlenDienst from './kennzahlen';
import * as manuelleMenge from './manuelleMenge';
import * as papierkorbDienst from './papierkorb';
import * as kaufpreisNachtrag from './kaufpreisNachtrag';
import * as lagerortRechte from './lagerortRechte';
import * as lagerortDienst from './lagerort';
import * as lagerortSetzen from './lagerortSetzen';
import { zugang, type BestandAbhaengigkeiten, type BestandKontext } from './kontext';

export type { BestandAbhaengigkeiten, BestandKontext } from './kontext';

export function erzeugeBestand(a: BestandAbhaengigkeiten, einblick?: Einblick<BestandKontext>) {
  const k: BestandKontext = baueKontext(a, zugang);
  einblick?.(k);
  return {
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
    // Nimmt den Zugang statt des Kontexts: Erfassungen rufen ihn mit dem Griff ihrer Transaktion.
    // setzeLagerort nimmt den Kontext: Ein neuer Ort braucht k.transaktion.
    lagerortDienst: {
      ...bindeZugang(k.db, lagerortDienst, [
        'benenneOrtUm',
        'lagerorte',
        'legeOrtAn',
        'loescheOrt',
        'ortFuerNeuerfassung',
        'orteVon',
        'vorgabeVon',
      ]),
      ...bindeZugang(k, lagerortSetzen),
    },

    ...bindeZugang(k, lagerortRechte, ['setzeVorgabe', 'lagerSchreibkonto', 'orteFuer']),
  };
}

export type BestandDienste = ReturnType<typeof erzeugeBestand>;
