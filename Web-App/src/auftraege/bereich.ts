/** Die Fabrik des Bereichs: Dienste als Closure über k (baueBereich, src/infra/bereich.ts). */
import type { Db } from '../../db/database';
import { mit, baueBereich, type Einblick } from '../infra/bereich';
import { Faecher } from '../infra/zwischenspeicher';
import { Arten, type Anmeldung } from './arten';
import * as dienst from './dienst';
import * as eigene from './eigene';
import * as hintergrund from './hintergrund';
import * as importAlsAuftrag from './importAlsAuftrag';
import * as importAuftrag from './importAuftrag';
import * as prozess from './prozess';
import * as startZustand from './startZustand';
import * as wiedervorlage from './wiedervorlage';
import * as zeitplan from './zeitplan';
import { zugang, type AuftraegeAbhaengigkeiten, type AuftraegeKontext } from './kontext';

export type { AuftraegeAbhaengigkeiten, AuftraegeKontext } from './kontext';

/** Die Arten meldet die Verdrahtung an (meldeArtAn); bis dahin nimmt die Warteschlange keine. */
export function erzeugeAuftraege(
  a: Omit<AuftraegeAbhaengigkeiten, 'faecher' | 'arten'>,
  einblick?: Einblick<AuftraegeKontext>,
) {
  const arten = new Arten();
  return baueBereich(
    { ...a, faecher: new Faecher(), arten },
    (db: Db) => zugang(db, a.lesevertrag),
    (k: AuftraegeKontext) => ({
      meldeArtAn: (an: Anmeldung) => arten.melde(an),
      angemeldeteArten: () => arten.alle(),
      pruefeNutzlast: arten.pruefe.bind(arten) as Arten['pruefe'],
      ergaenzeListenAuftrag: mit(k)(dienst.ergaenzeListenAuftrag),
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
      warteAufAuftrag: mit(k)(importAlsAuftrag.warteAufAuftrag),
      meldeJobStand: mit(k)(importAuftrag.emitJobStatus),
      jobGet: mit(k)(importAuftrag.jobGet),
      jobSet: mit(k)(importAuftrag.jobSet),
      jobUpdate: mit(k)(importAuftrag.jobUpdate),
      setzeImportFort: mit(k)(importAuftrag.setzeImportFort),
      beiImportStand: mit(k)(importAuftrag.beiImportStand),
      starteAuftrag: mit(k)(importAuftrag.starteAuftrag),
      meldeAuftrag: mit(k)(importAuftrag.meldeAuftrag),
      beendeAuftrag: mit(k)(importAuftrag.beendeAuftrag),
      istAbgebrochen: mit(k)(importAuftrag.istAbgebrochen),
      /** Aufträge, die ein Konto über ihren Schlüssel verfolgt. */
      eigenerAuftrag: mit(k)(eigene.eigenerAuftrag),
      loescheEigenen: mit(k)(eigene.loescheEigenen),
      zaehleLaufende: mit(k)(eigene.zaehleLaufende),
      loescheBeendete: mit(k)(eigene.loescheBeendete),
      wiedervorlage: {
        merkeVor: mit(k)(wiedervorlage.merkeVor),
        vergiss: mit(k)(wiedervorlage.vergiss),
        jetzt: mit(k)(wiedervorlage.jetzt),
        vorziehen: mit(k)(wiedervorlage.vorziehen),
        wartende: mit(k)(wiedervorlage.wartende),
        zahlen: mit(k)(wiedervorlage.zahlen),
      },
      meldeStartZustand: mit(k)(startZustand.meldeStartZustand),
      aktuellerStartZustand: mit(k)(startZustand.aktuellerStartZustand),
      zeitplanGeaendert: mit(k)(zeitplan.zeitplanGeaendert),
      ziehePlanVor: mit(k)(zeitplan.ziehePlanVor),
      planeNaechsten: mit(k)(zeitplan.planeNaechsten),
      planeAlle: mit(k)(zeitplan.planeAlle),
      taeglicheUhrzeit: mit(k)(zeitplan.taeglicheUhrzeit),
      meldeProzessAn: mit(k)(prozess.meldeProzessAn),
      meldeProzessAb: mit(k)(prozess.meldeProzessAb),
      ...ausDerTabelle(k),
    }),
    einblick,
  );
}

/** Was ohne eigene Regel aus Tabelle und Laufzustand durchgereicht wird. */
function ausDerTabelle(k: AuftraegeKontext) {
  return {
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
    zaehleZustand: k.laufzustand.zaehleZustand,
    // Je Art der laufende, sonst der zuletzt beendete Auftrag: die Kacheln der Verwaltung.
    letzteJeArt: k.auftraege.letzteJeArt,
  };
}

export type AuftraegeDienste = ReturnType<typeof erzeugeAuftraege>;
