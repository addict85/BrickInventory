/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as acquisitions from './acquisitions';
import * as bestandExportDienst from './bestandExport';
import * as gemeinsamDienst from './gemeinsam';
import * as inhalt from './inhalt';
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
  return baueBereich(
    a,
    zugang,
    (k: BestandKontext) => ({
      bucheTageserfassung: mit(k)(acquisitions.recordAcquisitionForDay),
      erfassungAmSelbenTag: mit(k)(acquisitions.findSameDayAcquisition),
      setzeGeschaetztenPreis: mit(k)(acquisitions.setzeGeschaetztenPreis),
      erfassungenInKontowaehrung: mit(k)(acquisitions.erfassungenInKontowaehrung),
      teileAlsCsv: mit(k)(bestandExportDienst.buildPartsCsv),
      figurenAlsCsv: mit(k)(bestandExportDienst.buildFigsCsv),
      verwendendeSets: mit(k)(gemeinsamDienst.verwendendeSets),
      loescheManuellesTeil: mit(k)(gemeinsamDienst.loescheManuellesTeil),
      loescheManuelleFigur: mit(k)(gemeinsamDienst.loescheManuelleFigur),
      setInhalt: {
        teileEintragen: mit(k)(inhalt.teileEintragen),
        figurenEintragen: mit(k)(inhalt.figurenEintragen),
        entfernen: mit(k)(inhalt.entfernen),
        kopieren: mit(k)(inhalt.kopieren),
      },
      manuell: {
        legeTeilAn: mit(k)(inhalt.legeTeilAn),
        legeFigurAn: mit(k)(inhalt.legeFigurAn),
        legeZeileAn: mit(k)(inhalt.legeZeileAn),
        teileDesKontos: mit(k)(inhalt.teileDesKontos),
        figurenDesKontos: mit(k)(inhalt.figurenDesKontos),
        teilzeileUmfaerben: mit(k)(inhalt.teilzeileUmfaerben),
      },
      setzeManuellenZustand: mit(k)(gemeinsamDienst.applyManualCondition),
      bestandsKennzahlen: mit(k)(kennzahlenDienst.getStats),
      passeManuelleMengeAn: mit(k)(manuelleMenge.passeManuelleMengeAn),
      legeInPapierkorb: mit(k)(papierkorbDienst.legeInPapierkorb),
      legeKaeufeInPapierkorb: mit(k)(papierkorbDienst.legeKaeufeInPapierkorb),
      listePapierkorb: mit(k)(papierkorbDienst.listePapierkorb),
      stelleWiederHer: mit(k)(papierkorbDienst.stelleWiederHer),
      loescheEndgueltig: mit(k)(papierkorbDienst.loescheEndgueltig),
      leerePapierkorb: mit(k)(papierkorbDienst.leerePapierkorb),
      raeumePapierkorbAuf: mit(k)(papierkorbDienst.raeumePapierkorbAuf),
      kaufpreiseNachtragen: mit(k)(kaufpreisNachtrag.run),
      lagerortDienst: {
        benenneOrtUm: mit(k)(lagerortDienst.benenneOrtUm),
        lagerorte: mit(k)(lagerortDienst.lagerorte),
        legeOrtAn: mit(k)(lagerortDienst.legeOrtAn),
        loescheOrt: mit(k)(lagerortDienst.loescheOrt),
        ortFuerNeuerfassung: mit(k)(lagerortDienst.ortFuerNeuerfassung),
        vorgabeVon: mit(k)(lagerortDienst.vorgabeVon),
        setzeLagerort: mit(k)(lagerortSetzen.setzeLagerort),
      },

      setzeVorgabe: mit(k)(lagerortRechte.setzeVorgabe),
      lagerSchreibkonto: mit(k)(lagerortRechte.lagerSchreibkonto),
      orteFuer: mit(k)(lagerortRechte.orteFuer),
    }),
    einblick,
  );
}

export type BestandDienste = ReturnType<typeof erzeugeBestand>;
