/** Die Fabrik des Bereichs: Jeder Dienst nimmt den Kontext als ersten Parameter;
 * erzeugeAuftraege bindet ihn einmal für alle. So greift kein Modul selbst auf
 * den Zugang des Prozesses zu, und ein Test gibt einen eigenen. */
import { baueKontext, bindeGenerisch, bindeZugang, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import * as anleitungsAuftrag from './anleitungsAuftrag';
import * as bricksetAuftrag from './bricksetAuftrag';
import * as dienst from './dienst';
import * as hintergrund from './hintergrund';
import * as importAlsAuftrag from './importAlsAuftrag';
import * as importAuftrag from './importAuftrag';
import * as jobMonitor from './jobMonitor';
import * as pdfDienste from './pdfAuftraege';
import * as prozess from './prozess';
import * as startZustand from './startZustand';
import * as zeitplan from './zeitplan';
import { zugang, type AuftraegeAbhaengigkeiten, type AuftraegeKontext } from './kontext';

export type { AuftraegeAbhaengigkeiten, AuftraegeKontext } from './kontext';

export function erzeugeAuftraege(a: Omit<AuftraegeAbhaengigkeiten, 'faecher'>, einblick?: Einblick<AuftraegeKontext>) {
  const k: AuftraegeKontext = baueKontext({ ...a, faecher: new Faecher() }, zugang);
  einblick?.(k);
  return {
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
    ...bindeZugang(k, jobMonitor, ['kacheln', 'imgDlAdd', 'imgDlPending', 'imgDlReset', 'kachel']),
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
    ...bindeZugang(k, prozess, ['meldeProzessAn', 'meldeProzessAb']),
    // Pacht, Belegen und Zurückgeben für den Worker (jobs/auftragsWorker.ts).
    lebenszeichen: k.auftraege.lebenszeichen,
    belegeAuftrag: k.auftraege.belegeAuftrag,
    gibZurueck: k.auftraege.gibZurueck,
    merkeExklusive: k.auftraege.merkeExklusive,
    // Pausen einer Art (CDN, Brickset drosseln) und das Aufräumen erledigter.
    pausiereArt: k.auftraege.pausiereArt,
    liesPause: k.auftraege.liesPause,
    raeumeErledigteAuf: k.auftraege.raeumeErledigteAuf,
    // Marken über Prozessgrenzen (Lebenszeichen, Altbestand, Abgleich); gelesen von der Verwaltung.
    liesZustand: k.laufzustand.liesZustand,
    setzeZustand: k.laufzustand.setzeZustand,
    loescheZustand: k.laufzustand.loescheZustand,
  };
}

export type AuftraegeDienste = ReturnType<typeof erzeugeAuftraege>;
