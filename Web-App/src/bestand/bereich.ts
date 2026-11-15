/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import * as acquisitions from './acquisitions';
import * as bestandExportDienst from './bestandExport';
import * as gemeinsamDienst from './gemeinsam';
import * as gemeinsamRepo from './repository/gemeinsam';
import * as setInhaltRepo from './repository/setInhalt';
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
      // Bausteine fremder Löschungen und Umzüge; in deren Transaktion über t.bestand gerufen.
      entferneSetInhalt: mit(k.db, gemeinsamRepo.entferneSetInhalt),
      kopiereSetInhalt: mit(k.db, gemeinsamRepo.kopiereSetInhalt),
      legeManuellAn: mit(k.db, gemeinsamRepo.legeManuellAn),
      manuelleTeileDesKontos: mit(k.db, gemeinsamRepo.manuelleTeileDesKontos),
      manuelleFigurenDesKontos: mit(k.db, gemeinsamRepo.manuelleFigurenDesKontos),
      legeTeilManuellAn: mit(k.db, gemeinsamRepo.legeTeilManuellAn),
      legeFigurManuellAn: mit(k.db, gemeinsamRepo.legeFigurManuellAn),
      setzeTeilLagerort: mit(k.db, gemeinsamRepo.setzeTeilLagerort),
      loescheTeilzeile: mit(k.db, gemeinsamRepo.loescheTeilzeile),
      faerbeTeilzeileUm: mit(k.db, gemeinsamRepo.faerbeTeilzeileUm),
      setFigurenEintragen: mit(k.db, setInhaltRepo.setFigurenEintragen),
      setTeileEintragen: mit(k.db, setInhaltRepo.setTeileEintragen),
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
        orteVon: mit(k)(lagerortDienst.orteVon),
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
