/** Die Fabrik des Bereichs: Dienste als Closure über k (buildArea, src/infra/bereich.ts). */
import type { Db } from '../../db/database';
import { mit, buildArea, type Inspect } from '../infra/bereich';
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
import { zugang, type JobsDependencies, type JobsContext } from './kontext';

export type { JobsDependencies, JobsContext } from './kontext';

/** Die Arten meldet die Verdrahtung an (reportKindAn); bis dahin nimmt die Warteschlange keine. */
export function createJobs(a: Omit<JobsDependencies, 'faecher' | 'arten'>, inspect?: Inspect<JobsContext>) {
  const arten = new Arten();
  return buildArea(
    { ...a, faecher: new Faecher(), arten },
    (db: Db) => zugang(db, a.lesevertrag),
    (k: JobsContext) => ({
      reportKindAn: (an: Anmeldung) => arten.melde(an),
      signedInKinds: () => arten.alle(),
      checkPayload: arten.pruefe.bind(arten) as Arten['pruefe'],
      supplementListenJob: mit(k)(dienst.supplementListenJob),
      setProgress: mit(k)(dienst.setProgress),
      erledigt: mit(k)(dienst.erledigt),
      fehlgeschlagen: mit(k)(dienst.fehlgeschlagen),
      verschoben: mit(k)(dienst.verschoben),
      endPause: mit(k)(dienst.endPause),
      countKind: mit(k)(dienst.countKind),
      atJobStatus: mit(k)(dienst.atJobStatus),
      atNewJob: mit(k)(dienst.atNewJob),
      checkMembership: mit(k)(dienst.checkMembership),
      placeJobOne: mit(k)(dienst.placeJobOne),
      placeOwnJobOne: mit(k)(dienst.placeOwnJobOne),
      inNamesOfJob: mit(k)(dienst.inNamesOfJob),
      jobsInOverview: mit(k)(hintergrund.jobsInOverview),
      emptyJobKind: mit(k)(hintergrund.emptyJobKind),
      auftragsArtJetzt: mit(k)(hintergrund.auftragsArtJetzt),
      auftragAbbrechen: mit(k)(hintergrund.auftragAbbrechen),
      retryJob: mit(k)(hintergrund.retryJob),
      setResult: mit(k)(importAlsAuftrag.setResult),
      setSlotError: mit(k)(importAlsAuftrag.setSlotError),
      waitOnJob: mit(k)(importAlsAuftrag.waitOnJob),
      reportJobStatus: mit(k)(importAuftrag.emitJobStatus),
      jobGet: mit(k)(importAuftrag.jobGet),
      jobSet: mit(k)(importAuftrag.jobSet),
      jobUpdate: mit(k)(importAuftrag.jobUpdate),
      setImportFort: mit(k)(importAuftrag.setImportFort),
      atImportStatus: mit(k)(importAuftrag.atImportStatus),
      startJob: mit(k)(importAuftrag.startJob),
      reportJob: mit(k)(importAuftrag.reportJob),
      beendeAuftrag: mit(k)(importAuftrag.beendeAuftrag),
      isAborted: mit(k)(importAuftrag.isAborted),
      /** Aufträge, die ein Konto über ihren Schlüssel verfolgt. */
      ownJob: mit(k)(eigene.ownJob),
      deleteOwn: mit(k)(eigene.deleteOwn),
      countRunning: mit(k)(eigene.countRunning),
      deleteEnded: mit(k)(eigene.deleteEnded),
      wiedervorlage: {
        rememberBefore: mit(k)(wiedervorlage.rememberBefore),
        vergiss: mit(k)(wiedervorlage.vergiss),
        jetzt: mit(k)(wiedervorlage.jetzt),
        prefer: mit(k)(wiedervorlage.prefer),
        wartende: mit(k)(wiedervorlage.wartende),
        zahlen: mit(k)(wiedervorlage.zahlen),
      },
      reportStartState: mit(k)(startZustand.reportStartState),
      currentStartState: mit(k)(startZustand.currentStartState),
      scheduleChanged: mit(k)(zeitplan.scheduleChanged),
      pullPlanBefore: mit(k)(zeitplan.pullPlanBefore),
      planeNext: mit(k)(zeitplan.planeNext),
      planeAll: mit(k)(zeitplan.planeAll),
      dailyTimeOfDay: mit(k)(zeitplan.dailyTimeOfDay),
      reportProcessAn: mit(k)(prozess.reportProcessAn),
      reportProcessAb: mit(k)(prozess.reportProcessAb),
      ...fromTheTable(k),
    }),
    inspect,
  );
}

/** Was ohne eigene Regel aus Tabelle und Laufzustand durchgereicht wird. */
function fromTheTable(k: JobsContext) {
  return {
    // Pacht, Belegen und Zurückgeben für den Worker (jobs/auftragsWorker.ts).
    lebenszeichen: k.auftraege.lebenszeichen,
    belegeAuftrag: k.auftraege.belegeAuftrag,
    giveBack: k.auftraege.giveBack,
    rememberExclusive: k.auftraege.rememberExclusive,
    // Pausen einer Art (CDN, Brickset drosseln) und das Aufräumen erledigter.
    pauseKind: k.auftraege.pauseKind,
    liesPause: k.auftraege.liesPause,
    cleanCompletedOn: k.auftraege.cleanCompletedOn,
    // Marken über Prozessgrenzen (Lebenszeichen, Altbestand, Abgleich); gelesen von der Verwaltung.
    liesZustand: k.laufzustand.liesZustand,
    setzeZustand: k.laufzustand.setzeZustand,
    deleteState: k.laufzustand.deleteState,
    countState: k.laufzustand.countState,
    // Je Art der laufende, sonst der zuletzt beendete Auftrag: die Kacheln der Verwaltung.
    letzteJeArt: k.auftraege.letzteJeArt,
  };
}

export type JobsServices = ReturnType<typeof createJobs>;
