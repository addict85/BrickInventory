/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { mit, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import { Arten, type Anmeldung } from './kinds';
import * as dienst from './service';
import * as eigene from './own';
import * as hintergrund from './background';
import * as importAlsAuftrag from './importAsJob';
import * as importAuftrag from './importJob';
import * as prozess from './process';
import * as startZustand from './startState';
import * as wiedervorlage from './resubmission';
import * as zeitplan from './schedule';
import { zugang, type JobsDependencies, type JobsContext } from './context';

export type { JobsDependencies, JobsContext } from './context';

/** The kinds are registered by the wiring (reportKindAn); until then the queue accepts none. */
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
      /** Jobs that an account tracks via their key. */
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

/** What is passed through from table and run state without a rule of its own. */
function fromTheTable(k: JobsContext) {
  return {
    // Lease, claim and return for the worker (jobs/jobWorker.ts).
    lebenszeichen: k.auftraege.lebenszeichen,
    belegeAuftrag: k.auftraege.belegeAuftrag,
    giveBack: k.auftraege.giveBack,
    rememberExclusive: k.auftraege.rememberExclusive,
    // Pauses of a kind (throttling CDN, Brickset) and cleaning up finished ones.
    pauseKind: k.auftraege.pauseKind,
    liesPause: k.auftraege.liesPause,
    cleanCompletedOn: k.auftraege.cleanCompletedOn,
    // Markers across process boundaries (sign of life, legacy data, reconciliation); read by the admin.
    liesZustand: k.laufzustand.liesZustand,
    setzeZustand: k.laufzustand.setzeZustand,
    deleteState: k.laufzustand.deleteState,
    countState: k.laufzustand.countState,
    // Per kind the running job, otherwise the most recently finished one: the admin's tiles.
    letzteJeArt: k.auftraege.letzteJeArt,
  };
}

export type JobsServices = ReturnType<typeof createJobs>;
