/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { withValue, buildArea, type Inspect } from '../infra/area';
import { Faecher } from '../infra/cache';
import { Kinds, type Login } from './kinds';
import * as service from './service';
import * as own from './own';
import * as background from './background';
import * as importAsJob from './importAsJob';
import * as importJob from './importJob';
import * as prozess from './process';
import * as startState from './startState';
import * as resubmission from './resubmission';
import * as schedule from './schedule';
import { access, type JobsDependencies, type JobsContext } from './context';

export type { JobsDependencies, JobsContext } from './context';

/** The kinds are registered by the wiring (reportKindAn); until then the queue accepts none. */
export function createJobs(a: Omit<JobsDependencies, 'faecher' | 'arten'>, inspect?: Inspect<JobsContext>) {
  const arten = new Kinds();
  return buildArea(
    { ...a, faecher: new Faecher(), arten },
    (db: Db) => access(db, a.lesevertrag),
    (k: JobsContext) => ({
      reportKindAn: (an: Login) => arten.report(an),
      signedInKinds: () => arten.all(),
      checkPayload: arten.check.bind(arten) as Kinds['check'],
      supplementListenJob: withValue(k)(service.supplementListenJob),
      setProgress: withValue(k)(service.setProgress),
      erledigt: withValue(k)(service.done),
      fehlgeschlagen: withValue(k)(service.fehlgeschlagen),
      verschoben: withValue(k)(service.verschoben),
      endPause: withValue(k)(service.endPause),
      countKind: withValue(k)(service.countKind),
      atJobStatus: withValue(k)(service.atJobStatus),
      atNewJob: withValue(k)(service.atNewJob),
      checkMembership: withValue(k)(service.checkMembership),
      placeJobOne: withValue(k)(service.placeJobOne),
      placeOwnJobOne: withValue(k)(service.placeOwnJobOne),
      inNamesOfJob: withValue(k)(service.inNamesOfJob),
      jobsInOverview: withValue(k)(background.jobsInOverview),
      emptyJobKind: withValue(k)(background.emptyJobKind),
      auftragsArtJetzt: withValue(k)(background.jobKindNow),
      auftragAbbrechen: withValue(k)(background.auftragAbbrechen),
      retryJob: withValue(k)(background.retryJob),
      setResult: withValue(k)(importAsJob.setResult),
      setSlotError: withValue(k)(importAsJob.setSlotError),
      waitOnJob: withValue(k)(importAsJob.waitOnJob),
      reportJobStatus: withValue(k)(importJob.emitJobStatus),
      jobGet: withValue(k)(importJob.jobGet),
      jobSet: withValue(k)(importJob.jobSet),
      jobUpdate: withValue(k)(importJob.jobUpdate),
      setImportFort: withValue(k)(importJob.setImportFort),
      atImportStatus: withValue(k)(importJob.atImportStatus),
      startJob: withValue(k)(importJob.startJob),
      reportJob: withValue(k)(importJob.reportJob),
      beendeAuftrag: withValue(k)(importJob.finishJob),
      isAborted: withValue(k)(importJob.isAborted),
      /** Jobs that an account tracks via their key. */
      ownJob: withValue(k)(own.ownJob),
      deleteOwn: withValue(k)(own.deleteOwn),
      countRunning: withValue(k)(own.countRunning),
      deleteEnded: withValue(k)(own.deleteEnded),
      wiedervorlage: {
        rememberBefore: withValue(k)(resubmission.rememberBefore),
        vergiss: withValue(k)(resubmission.forget),
        jetzt: withValue(k)(resubmission.now),
        prefer: withValue(k)(resubmission.prefer),
        wartende: withValue(k)(resubmission.waiting),
        zahlen: withValue(k)(resubmission.numbers),
      },
      reportStartState: withValue(k)(startState.reportStartState),
      currentStartState: withValue(k)(startState.currentStartState),
      scheduleChanged: withValue(k)(schedule.scheduleChanged),
      pullPlanBefore: withValue(k)(schedule.pullPlanBefore),
      planeNext: withValue(k)(schedule.planeNext),
      planeAll: withValue(k)(schedule.planeAll),
      dailyTimeOfDay: withValue(k)(schedule.dailyTimeOfDay),
      reportProcessAn: withValue(k)(prozess.reportProcessAn),
      reportProcessAb: withValue(k)(prozess.reportProcessAb),
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
