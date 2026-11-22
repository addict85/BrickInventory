/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Db } from '../../db/database';
import { imSystem, bound, type Context } from '../infra/area';
import type { JobsReadContract } from './readContract';
import type { Compartments } from '../infra/cache';
import type { SettingsServices } from '../settings';
import * as jobs from './repository/jobs';
import * as importStand from './repository/importStatus';
import * as runState from './repository/runState';
import type { Clock } from '../infra/clock';
import type { Kinds } from './kinds';

export interface JobsDependencies {
  clock: Clock;
  db: Db;
  compartments: Compartments;
  settings: SettingsServices;
  /** The registered kinds; shared across all sets of this access. */
  kinds: Kinds;
  readContract: JobsReadContract;
}

/** The queue belongs to all accounts; whoever processes or manages it needs the system frame.
 * What a request reads about its own job runs under row security and filtered by account. */
const QUEUE = 'Job-Prozess und Einstellen: Aufträge aller Konten und solche ohne Konto';
const MANAGEMENT = 'Verwaltung: Übersicht über die Aufträge aller Konten';

export const access = (db: Db, l: JobsReadContract) => ({
  jobs: {
    addJobOne: imSystem(db, QUEUE, jobs.addJobOne),
    addOwnJobOne: bound(db)(jobs.addOwnJobOne),
    enqueueList: imSystem(db, QUEUE, jobs.enqueueList),
    claimJob: imSystem(db, QUEUE, jobs.claimJob),
    rememberExclusive: imSystem(db, QUEUE, jobs.rememberExclusive),
    heartbeat: imSystem(db, QUEUE, jobs.heartbeat),
    belongsStill: imSystem(db, QUEUE, jobs.belongsStill),
    writeProgress: imSystem(db, QUEUE, jobs.writeProgress),
    setDone: imSystem(db, QUEUE, jobs.setDone),
    setFailed: imSystem(db, QUEUE, jobs.setFailed),
    setMoved: imSystem(db, QUEUE, jobs.setMoved),
    giveBack: imSystem(db, QUEUE, jobs.giveBack),
    cleanCompletedOn: imSystem(db, QUEUE, jobs.cleanCompletedOn),
    liesPause: imSystem(db, QUEUE, jobs.liesPause),
    pauseKind: imSystem(db, QUEUE, jobs.pauseKind),
    deletePause: imSystem(db, QUEUE, jobs.deletePause),
    setAborted: imSystem(db, QUEUE, jobs.setAborted),
    placeAgainOne: imSystem(db, QUEUE, jobs.placeAgainOne),
    emptyKind: imSystem(db, QUEUE, jobs.emptyKind),
    makeDue: imSystem(db, QUEUE, jobs.makeDue),
    statusNumbers: imSystem(db, MANAGEMENT, jobs.statusNumbers),
    accountRole: bound(l)(imSystem(db, MANAGEMENT, jobs.accountRole)),
    setDueDate: imSystem(db, QUEUE, jobs.setDueDate),
    pullAppointmentBefore: imSystem(db, QUEUE, jobs.pullAppointmentBefore),
    runningKind: imSystem(db, QUEUE, jobs.runningKind),
    highestCounter: imSystem(db, QUEUE, jobs.highestCounter),
    writeResubmission: imSystem(db, QUEUE, jobs.writeResubmission),
    openDelete: imSystem(db, QUEUE, jobs.openDelete),
    waitingTheKind: imSystem(db, QUEUE, jobs.waitingTheKind),
    numbersTheKind: imSystem(db, QUEUE, jobs.numbersTheKind),
    jobList: imSystem(db, MANAGEMENT, jobs.jobList),
    lastPerKind: imSystem(db, MANAGEMENT, jobs.lastPerKind),
    numbersJeKindAndStatus: imSystem(db, MANAGEMENT, jobs.numbersJeKindAndStatus),
    runningPauses: imSystem(db, QUEUE, jobs.runningPauses),
    jobStatus: bound(db)(jobs.jobStatus),
    pullAppointmentsBefore: imSystem(db, QUEUE, jobs.pullAppointmentsBefore),
    writeResult: imSystem(db, QUEUE, jobs.writeResult),
  },
  importStand: {
    markOrphaned: bound(db)(importStand.markOrphaned),
    importStand: bound(db)(importStand.importStand),
    writeImportStatus: bound(db)(importStand.writeImportStatus),
    changeImportStatus: bound(db)(importStand.changeImportStatus),
    setRunFort: bound(db)(importStand.setRunFort),
  },
  runState: {
    readState: bound(db)(runState.readState),
    setState: bound(db)(runState.setState),
    deleteState: bound(db)(runState.deleteState),
    countState: bound(db)(runState.countState),
  },
  ownRows: {
    ownRow: bound(db)(jobs.ownRow),
    countRunningRows: bound(db)(jobs.countRunningRows),
    deleteOwnRow: bound(db)(jobs.deleteOwnRow),
    deleteEndedRows: imSystem(db, 'Aufräumen über alle Konten', jobs.deleteEndedRows),
  },
});
export type JobsContext = Context<JobsDependencies, ReturnType<typeof access>>;
