/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Db } from '../../db/database';
import { asSystem, bound, type Context } from '../infra/area';
import type { JobsReadContract } from './readContract';
import type { Compartments } from '../infra/cache';
import type { SettingsServices } from '../settings';
import * as jobs from './repository/jobs';
import * as importState from './repository/importStatus';
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
    addJobOne: asSystem(db, QUEUE, jobs.addJobOne),
    addOwnJobOne: bound(db)(jobs.addOwnJobOne),
    enqueueList: asSystem(db, QUEUE, jobs.enqueueList),
    claimJob: asSystem(db, QUEUE, jobs.claimJob),
    rememberExclusive: asSystem(db, QUEUE, jobs.rememberExclusive),
    heartbeat: asSystem(db, QUEUE, jobs.heartbeat),
    belongsStill: asSystem(db, QUEUE, jobs.belongsStill),
    writeProgress: asSystem(db, QUEUE, jobs.writeProgress),
    setDone: asSystem(db, QUEUE, jobs.setDone),
    setFailed: asSystem(db, QUEUE, jobs.setFailed),
    setMoved: asSystem(db, QUEUE, jobs.setMoved),
    giveBack: asSystem(db, QUEUE, jobs.giveBack),
    cleanCompletedOn: asSystem(db, QUEUE, jobs.cleanCompletedOn),
    readPause: asSystem(db, QUEUE, jobs.readPause),
    pauseKind: asSystem(db, QUEUE, jobs.pauseKind),
    deletePause: asSystem(db, QUEUE, jobs.deletePause),
    setAborted: asSystem(db, QUEUE, jobs.setAborted),
    placeAgainOne: asSystem(db, QUEUE, jobs.placeAgainOne),
    emptyKind: asSystem(db, QUEUE, jobs.emptyKind),
    makeDue: asSystem(db, QUEUE, jobs.makeDue),
    statusNumbers: asSystem(db, MANAGEMENT, jobs.statusNumbers),
    accountRole: bound(l)(asSystem(db, MANAGEMENT, jobs.accountRole)),
    setDueDate: asSystem(db, QUEUE, jobs.setDueDate),
    pullAppointmentBefore: asSystem(db, QUEUE, jobs.pullAppointmentBefore),
    runningKind: asSystem(db, QUEUE, jobs.runningKind),
    highestCounter: asSystem(db, QUEUE, jobs.highestCounter),
    writeResubmission: asSystem(db, QUEUE, jobs.writeResubmission),
    openDelete: asSystem(db, QUEUE, jobs.openDelete),
    waitingTheKind: asSystem(db, QUEUE, jobs.waitingTheKind),
    numbersTheKind: asSystem(db, QUEUE, jobs.numbersTheKind),
    jobList: asSystem(db, MANAGEMENT, jobs.jobList),
    lastPerKind: asSystem(db, MANAGEMENT, jobs.lastPerKind),
    countsByKindAndStatus: asSystem(db, MANAGEMENT, jobs.countsByKindAndStatus),
    runningPauses: asSystem(db, QUEUE, jobs.runningPauses),
    jobStatus: bound(db)(jobs.jobStatus),
    pullAppointmentsBefore: asSystem(db, QUEUE, jobs.pullAppointmentsBefore),
    writeResult: asSystem(db, QUEUE, jobs.writeResult),
  },
  importState: {
    markOrphaned: bound(db)(importState.markOrphaned),
    importState: bound(db)(importState.importState),
    writeImportStatus: bound(db)(importState.writeImportStatus),
    changeImportStatus: bound(db)(importState.changeImportStatus),
    setRunProgress: bound(db)(importState.setRunProgress),
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
    deleteEndedRows: asSystem(db, 'Aufräumen über alle Konten', jobs.deleteEndedRows),
  },
});
export type JobsContext = Context<JobsDependencies, ReturnType<typeof access>>;
