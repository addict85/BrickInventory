/** What the services receive; separate from area.ts so that no import cycle arises. */
import type { Db } from '../../db/database';
import { imSystem, withValue, type Context } from '../infra/area';
import type { JobsReadContract } from './readContract';
import type { Faecher } from '../infra/cache';
import type { SettingsServices } from '../settings';
import * as jobs from './repository/jobs';
import * as importStand from './repository/importStatus';
import * as runState from './repository/runState';
import type { Clock } from '../infra/clock';
import type { Kinds } from './kinds';

export interface JobsDependencies {
  uhr: Clock;
  db: Db;
  faecher: Faecher;
  einstellungen: SettingsServices;
  /** The registered kinds; shared across all sets of this access. */
  arten: Kinds;
  lesevertrag: JobsReadContract;
}

/** The queue belongs to all accounts; whoever processes or manages it needs the system frame.
 * What a request reads about its own job runs under row security and filtered by account. */
const QUEUE = 'Job-Prozess und Einstellen: Aufträge aller Konten und solche ohne Konto';
const MANAGEMENT = 'Verwaltung: Übersicht über die Aufträge aller Konten';

export const access = (db: Db, l: JobsReadContract) => ({
  auftraege: {
    addJobOne: imSystem(db, QUEUE, jobs.addJobOne),
    addOwnJobOne: withValue(db)(jobs.addOwnJobOne),
    addListAn: imSystem(db, QUEUE, jobs.enqueueList),
    belegeAuftrag: imSystem(db, QUEUE, jobs.claimJob),
    rememberExclusive: imSystem(db, QUEUE, jobs.rememberExclusive),
    lebenszeichen: imSystem(db, QUEUE, jobs.heartbeat),
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
    accountRole: withValue(l)(imSystem(db, MANAGEMENT, jobs.accountRole)),
    setDueDate: imSystem(db, QUEUE, jobs.setDueDate),
    pullAppointmentBefore: imSystem(db, QUEUE, jobs.pullAppointmentBefore),
    runningKind: imSystem(db, QUEUE, jobs.runningKind),
    highestCounter: imSystem(db, QUEUE, jobs.highestCounter),
    writeResubmission: imSystem(db, QUEUE, jobs.writeResubmission),
    openDelete: imSystem(db, QUEUE, jobs.openDelete),
    waitingTheKind: imSystem(db, QUEUE, jobs.waitingTheKind),
    numbersTheKind: imSystem(db, QUEUE, jobs.numbersTheKind),
    jobList: imSystem(db, MANAGEMENT, jobs.jobList),
    letzteJeArt: imSystem(db, MANAGEMENT, jobs.lastPerKind),
    numbersJeKindAndStatus: imSystem(db, MANAGEMENT, jobs.numbersJeKindAndStatus),
    runningPauses: imSystem(db, QUEUE, jobs.runningPauses),
    jobStatus: withValue(db)(jobs.jobStatus),
    pullAppointmentsBefore: imSystem(db, QUEUE, jobs.pullAppointmentsBefore),
    writeResult: imSystem(db, QUEUE, jobs.writeResult),
  },
  importStand: {
    markOrphaned: withValue(db)(importStand.markOrphaned),
    importStand: withValue(db)(importStand.importStand),
    writeImportStatus: withValue(db)(importStand.writeImportStatus),
    changeImportStatus: withValue(db)(importStand.changeImportStatus),
    setRunFort: withValue(db)(importStand.setRunFort),
  },
  laufzustand: {
    liesZustand: withValue(db)(runState.readState),
    setzeZustand: withValue(db)(runState.setState),
    deleteState: withValue(db)(runState.deleteState),
    countState: withValue(db)(runState.countState),
  },
  eigene: {
    ownRow: withValue(db)(jobs.ownRow),
    countRunningRows: withValue(db)(jobs.countRunningRows),
    deleteOwnRow: withValue(db)(jobs.deleteOwnRow),
    deleteEndedRows: imSystem(db, 'Aufräumen über alle Konten', jobs.deleteEndedRows),
  },
});
export type JobsContext = Context<JobsDependencies, ReturnType<typeof access>>;
