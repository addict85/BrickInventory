/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext als ersten Parameter;
 * erzeugeAuftraege bindet ihn einmal für alle. So greift kein Modul selbst auf
 * den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import { baueKontext, bindeGenerisch, bindeZugang } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as anleitungsAuftrag from './anleitungsAuftrag';
import * as bricksetAuftrag from './bricksetAuftrag';
import * as dienst from './dienst';
import * as hintergrund from './hintergrund';
import * as importAlsAuftrag from './importAlsAuftrag';
import * as importAuftrag from './importAuftrag';
import * as jobMonitor from './jobMonitor';
import * as pdfDienste from './pdfAuftraege';
import * as startZustand from './startZustand';
import * as zeitplan from './zeitplan';
import { zugang, type AuftraegeAbhaengigkeiten, type AuftraegeKontext } from './kontext';

export type { AuftraegeAbhaengigkeiten, AuftraegeKontext } from './kontext';

export function erzeugeAuftraege(a: Omit<AuftraegeAbhaengigkeiten, 'faecher'>) {
  const k: AuftraegeKontext = baueKontext({ ...a, faecher: new Faecher() }, zugang);
  return {
    ...k,
    ...bindeZugang(k, bricksetAuftrag, [
      'bricksetVormerken',
      'bricksetAusWiedervorlage',
      'bricksetTermineVorziehen',
      'bricksetListe',
      'bricksetZahlen',
      'bricksetJetzt',
      'bricksetFaelligAb',
    ]),
    ...bindeZugang(k, dienst, [
      'merkePreiseVor',
      'setzeFortschritt',
      'erledigt',
      'fehlgeschlagen',
      'verschoben',
      'beendePause',
      'zaehleArt',
      'beiAuftragsStand',
      'beiNeuemAuftrag',
      'pruefeZugehoerigkeit',
    ]),
    stelleAuftragEin: bindeGenerisch(k)(dienst.stelleAuftragEin),
    imNamenDesAuftrags: bindeGenerisch(k)(dienst.imNamenDesAuftrags),
    ...bindeZugang(k, hintergrund, [
      'auftraegeImUeberblick',
      'leereAuftragsArt',
      'auftragsArtJetzt',
      'auftragAbbrechen',
      'auftragWiederholen',
    ]),
    ...bindeZugang(k, importAlsAuftrag, ['setzeErgebnis', 'setzeFachfehler']),
    importAlsAuftrag: bindeGenerisch(k)(importAlsAuftrag.importAlsAuftrag),
    ...bindeZugang(k, importAuftrag, [
      'emitJobStatus',
      'jobGet',
      'jobSet',
      'jobUpdate',
      'setzeImportFort',
      'beiImportStand',
      'starteAuftrag',
      'meldeAuftrag',
      'beendeAuftrag',
      'istAbgebrochen',
    ]),
    ...bindeZugang(k, jobMonitor, ['all', 'imgDlAdd', 'imgDlPending', 'imgDlReset', 'get']),
    ...bindeZugang(k, pdfDienste, ['liesAuftrag', 'loescheAuftrag', 'pdfAuftragStarten', 'cleanOldPdfJobs']),
    ...bindeZugang(k, startZustand, ['meldeStartZustand', 'aktuellerStartZustand']),
    ...bindeZugang(k, zeitplan, [
      'zeitplanGeaendert',
      'ziehePlanVor',
      'planeNaechsten',
      'planeAlle',
      'taeglicheUhrzeit',
    ]),
    ...bindeZugang(k, anleitungsAuftrag, ['anleitungEinreihen']),
  };
}

export type AuftraegeDienste = ReturnType<typeof erzeugeAuftraege>;
