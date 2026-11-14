/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import { mit, baueBereich, type Einblick } from '../infra/bereich';
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
  return baueBereich(
    { ...a, faecher: new Faecher() },
    zugang,
    (k: AuftraegeKontext) => ({
      bricksetVormerken: mit(k)(bricksetAuftrag.bricksetVormerken),
      bricksetAusWiedervorlage: mit(k)(bricksetAuftrag.bricksetAusWiedervorlage),
      bricksetTermineVorziehen: mit(k)(bricksetAuftrag.bricksetTermineVorziehen),
      bricksetListe: mit(k)(bricksetAuftrag.bricksetListe),
      bricksetZahlen: mit(k)(bricksetAuftrag.bricksetZahlen),
      bricksetJetzt: mit(k)(bricksetAuftrag.bricksetJetzt),
      bricksetFaelligAb: mit(k)(bricksetAuftrag.bricksetFaelligAb),
      merkePreiseVor: mit(k)(dienst.merkePreiseVor),
      setzeFortschritt: mit(k)(dienst.setzeFortschritt),
      erledigt: mit(k)(dienst.erledigt),
      fehlgeschlagen: mit(k)(dienst.fehlgeschlagen),
      verschoben: mit(k)(dienst.verschoben),
      beendePause: mit(k)(dienst.beendePause),
      zaehleArt: mit(k)(dienst.zaehleArt),
      beiAuftragsStand: mit(k)(dienst.beiAuftragsStand),
      beiNeuemAuftrag: mit(k)(dienst.beiNeuemAuftrag),
      pruefeZugehoerigkeit: mit(k)(dienst.pruefeZugehoerigkeit),
      stelleAuftragEin: mit(k)(dienst.stelleAuftragEin),
      stelleEigenenAuftragEin: mit(k)(dienst.stelleEigenenAuftragEin),
      imNamenDesAuftrags: mit(k)(dienst.imNamenDesAuftrags),
      auftraegeImUeberblick: mit(k)(hintergrund.auftraegeImUeberblick),
      leereAuftragsArt: mit(k)(hintergrund.leereAuftragsArt),
      auftragsArtJetzt: mit(k)(hintergrund.auftragsArtJetzt),
      auftragAbbrechen: mit(k)(hintergrund.auftragAbbrechen),
      auftragWiederholen: mit(k)(hintergrund.auftragWiederholen),
      setzeErgebnis: mit(k)(importAlsAuftrag.setzeErgebnis),
      setzeFachfehler: mit(k)(importAlsAuftrag.setzeFachfehler),
      importAlsAuftrag: mit(k)(importAlsAuftrag.importAlsAuftrag),
      emitJobStatus: mit(k)(importAuftrag.emitJobStatus),
      jobGet: mit(k)(importAuftrag.jobGet),
      jobSet: mit(k)(importAuftrag.jobSet),
      jobUpdate: mit(k)(importAuftrag.jobUpdate),
      setzeImportFort: mit(k)(importAuftrag.setzeImportFort),
      beiImportStand: mit(k)(importAuftrag.beiImportStand),
      starteAuftrag: mit(k)(importAuftrag.starteAuftrag),
      meldeAuftrag: mit(k)(importAuftrag.meldeAuftrag),
      beendeAuftrag: mit(k)(importAuftrag.beendeAuftrag),
      istAbgebrochen: mit(k)(importAuftrag.istAbgebrochen),
      kacheln: mit(k)(jobMonitor.kacheln),
      imgDlAdd: mit(k)(jobMonitor.imgDlAdd),
      imgDlPending: mit(k)(jobMonitor.imgDlPending),
      imgDlReset: mit(k)(jobMonitor.imgDlReset),
      kachel: mit(k)(jobMonitor.kachel),
      liesAuftrag: mit(k)(pdfDienste.liesAuftrag),
      loescheAuftrag: mit(k)(pdfDienste.loescheAuftrag),
      pdfAuftragStarten: mit(k)(pdfDienste.pdfAuftragStarten),
      cleanOldPdfJobs: mit(k)(pdfDienste.cleanOldPdfJobs),
      meldeStartZustand: mit(k)(startZustand.meldeStartZustand),
      aktuellerStartZustand: mit(k)(startZustand.aktuellerStartZustand),
      zeitplanGeaendert: mit(k)(zeitplan.zeitplanGeaendert),
      ziehePlanVor: mit(k)(zeitplan.ziehePlanVor),
      planeNaechsten: mit(k)(zeitplan.planeNaechsten),
      planeAlle: mit(k)(zeitplan.planeAlle),
      taeglicheUhrzeit: mit(k)(zeitplan.taeglicheUhrzeit),
      anleitungEinreihen: mit(k)(anleitungsAuftrag.anleitungEinreihen),
      meldeProzessAn: mit(k)(prozess.meldeProzessAn),
      meldeProzessAb: mit(k)(prozess.meldeProzessAb),
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
    }),
    einblick,
  );
}

export type AuftraegeDienste = ReturnType<typeof erzeugeAuftraege>;
