/** The area's factory: services as a closure over k (buildArea, src/infra/area.ts). */
import type { Db } from '../../db/database';
import { bound, buildArea, type Inspect } from '../infra/area';
import { Compartments } from '../infra/cache';
import { Kinds, type Login } from './kinds';
import * as service from './service';
import * as own from './own';
import * as background from './background';
import * as importAsJob from './importAsJob';
import * as importJob from './importJob';
import * as process from './process';
import * as startState from './startState';
import * as resubmission from './resubmission';
import * as schedule from './schedule';
import { access, type JobsDependencies, type JobsContext } from './context';

export type { JobsDependencies, JobsContext } from './context';

/** The kinds are registered by the wiring (reportKindAn); until then the queue accepts none. */
export function createJobs(a: Omit<JobsDependencies, 'faecher' | 'arten'>, inspect?: Inspect<JobsContext>) {
  const arten = new Kinds();
  return buildArea(
    { ...a, faecher: new Compartments(), arten },
    (db: Db) => access(db, a.lesevertrag),
    (k: JobsContext) => ({
      registerKind: (an: Login) => arten.report(an),
      signedInKinds: () => arten.all(),
      checkPayload: arten.check.bind(arten) as Kinds['check'],
      supplementListenJob: bound(k)(service.supplementListenJob),
      setProgress: bound(k)(service.setProgress),
      done: bound(k)(service.done),
      failed: bound(k)(service.failed),
      moved: bound(k)(service.moved),
      endPause: bound(k)(service.endPause),
      countKind: bound(k)(service.countKind),
      atJobStatus: bound(k)(service.atJobStatus),
      atNewJob: bound(k)(service.atNewJob),
      checkMembership: bound(k)(service.checkMembership),
      placeJobOne: bound(k)(service.placeJobOne),
      placeOwnJobOne: bound(k)(service.placeOwnJobOne),
      inNamesOfJob: bound(k)(service.inNamesOfJob),
      jobsInOverview: bound(k)(background.jobsInOverview),
      emptyJobKind: bound(k)(background.emptyJobKind),
      jobKindNow: bound(k)(background.jobKindNow),
      cancelJob: bound(k)(background.auftragAbbrechen),
      retryJob: bound(k)(background.retryJob),
      setResult: bound(k)(importAsJob.setResult),
      setSlotError: bound(k)(importAsJob.setSlotError),
      waitOnJob: bound(k)(importAsJob.waitOnJob),
      reportJobStatus: bound(k)(importJob.emitJobStatus),
      jobGet: bound(k)(importJob.jobGet),
      jobSet: bound(k)(importJob.jobSet),
      jobUpdate: bound(k)(importJob.jobUpdate),
      setImportFort: bound(k)(importJob.setImportFort),
      atImportStatus: bound(k)(importJob.atImportStatus),
      startJob: bound(k)(importJob.startJob),
      reportJob: bound(k)(importJob.reportJob),
      finishJob: bound(k)(importJob.finishJob),
      isAborted: bound(k)(importJob.isAborted),
      /** Jobs that an account tracks via their key. */
      ownJob: bound(k)(own.ownJob),
      deleteOwn: bound(k)(own.deleteOwn),
      countRunning: bound(k)(own.countRunning),
      deleteEnded: bound(k)(own.deleteEnded),
      wiedervorlage: {
        rememberBefore: bound(k)(resubmission.rememberBefore),
        forget: bound(k)(resubmission.forget),
        now: bound(k)(resubmission.now),
        prefer: bound(k)(resubmission.prefer),
        waiting: bound(k)(resubmission.waiting),
        numbers: bound(k)(resubmission.numbers),
      },
      reportStartState: bound(k)(startState.reportStartState),
      currentStartState: bound(k)(startState.currentStartState),
      scheduleChanged: bound(k)(schedule.scheduleChanged),
      pullPlanBefore: bound(k)(schedule.pullPlanBefore),
      planeNext: bound(k)(schedule.planeNext),
      planeAll: bound(k)(schedule.planeAll),
      dailyTimeOfDay: bound(k)(schedule.dailyTimeOfDay),
      registerProcess: bound(k)(process.registerProcess),
      deregisterProcess: bound(k)(process.deregisterProcess),
      ...fromTheTable(k),
    }),
    inspect,
  );
}

/** What is passed through from table and run state without a rule of its own. */
function fromTheTable(k: JobsContext) {
  return {
    // Lease, claim and return for the worker (jobs/jobWorker.ts).
    heartbeat: k.auftraege.heartbeat,
    claimJob: k.auftraege.claimJob,
    giveBack: k.auftraege.giveBack,
    rememberExclusive: k.auftraege.rememberExclusive,
    // Pauses of a kind (throttling CDN, Brickset) and cleaning up finished ones.
    pauseKind: k.auftraege.pauseKind,
    liesPause: k.auftraege.liesPause,
    cleanCompletedOn: k.auftraege.cleanCompletedOn,
    // Markers across process boundaries (sign of life, legacy data, reconciliation); read by the admin.
    readState: k.laufzustand.readState,
    setState: k.laufzustand.setState,
    deleteState: k.laufzustand.deleteState,
    countState: k.laufzustand.countState,
    // Per kind the running job, otherwise the most recently finished one: the admin's tiles.
    lastPerKind: k.auftraege.lastPerKind,
  };
}

export type JobsServices = ReturnType<typeof createJobs>;
