/** Was die Dienste bekommen; getrennt von bereich.ts, damit kein Importzyklus entsteht. */
import type { Db } from '../../db/database';
import { imSystem, mit, type Kontext } from '../infra/area';
import type { JobsReadContract } from './readContract';
import type { Faecher } from '../infra/cache';
import type { SettingsServices } from '../settings';
import * as auftraege from './repository/jobs';
import * as importStand from './repository/importStatus';
import * as laufzustand from './repository/runState';
import type { Uhr } from '../infra/clock';
import type { Arten } from './kinds';

export interface JobsDependencies {
  uhr: Uhr;
  db: Db;
  faecher: Faecher;
  einstellungen: SettingsServices;
  /** Die angemeldeten Arten; geteilt über alle Sätze dieses Zugangs. */
  arten: Arten;
  lesevertrag: JobsReadContract;
}

/** Die Warteschlange gehört allen Konten; wer sie abarbeitet oder verwaltet, braucht den Systemrahmen.
 * Was eine Anfrage über ihren eigenen Auftrag liest, läuft unter Zeilenschutz und nach Konto gefiltert. */
const WARTESCHLANGE = 'Job-Prozess und Einstellen: Aufträge aller Konten und solche ohne Konto';
const MANAGEMENT = 'Verwaltung: Übersicht über die Aufträge aller Konten';

export const zugang = (db: Db, l: JobsReadContract) => ({
  auftraege: {
    addJobOne: imSystem(db, WARTESCHLANGE, auftraege.addJobOne),
    addOwnJobOne: mit(db)(auftraege.addOwnJobOne),
    addListAn: imSystem(db, WARTESCHLANGE, auftraege.addListAn),
    belegeAuftrag: imSystem(db, WARTESCHLANGE, auftraege.belegeAuftrag),
    rememberExclusive: imSystem(db, WARTESCHLANGE, auftraege.rememberExclusive),
    lebenszeichen: imSystem(db, WARTESCHLANGE, auftraege.lebenszeichen),
    belongsStill: imSystem(db, WARTESCHLANGE, auftraege.belongsStill),
    writeProgress: imSystem(db, WARTESCHLANGE, auftraege.writeProgress),
    setDone: imSystem(db, WARTESCHLANGE, auftraege.setDone),
    setFailed: imSystem(db, WARTESCHLANGE, auftraege.setFailed),
    setMoved: imSystem(db, WARTESCHLANGE, auftraege.setMoved),
    giveBack: imSystem(db, WARTESCHLANGE, auftraege.giveBack),
    cleanCompletedOn: imSystem(db, WARTESCHLANGE, auftraege.cleanCompletedOn),
    liesPause: imSystem(db, WARTESCHLANGE, auftraege.liesPause),
    pauseKind: imSystem(db, WARTESCHLANGE, auftraege.pauseKind),
    deletePause: imSystem(db, WARTESCHLANGE, auftraege.deletePause),
    setAborted: imSystem(db, WARTESCHLANGE, auftraege.setAborted),
    placeAgainOne: imSystem(db, WARTESCHLANGE, auftraege.placeAgainOne),
    emptyKind: imSystem(db, WARTESCHLANGE, auftraege.emptyKind),
    makeDue: imSystem(db, WARTESCHLANGE, auftraege.makeDue),
    statusNumbers: imSystem(db, MANAGEMENT, auftraege.statusNumbers),
    accountRole: mit(l)(imSystem(db, MANAGEMENT, auftraege.accountRole)),
    setDueDate: imSystem(db, WARTESCHLANGE, auftraege.setDueDate),
    pullAppointmentBefore: imSystem(db, WARTESCHLANGE, auftraege.pullAppointmentBefore),
    runningKind: imSystem(db, WARTESCHLANGE, auftraege.runningKind),
    highestCounter: imSystem(db, WARTESCHLANGE, auftraege.highestCounter),
    writeResubmission: imSystem(db, WARTESCHLANGE, auftraege.writeResubmission),
    openDelete: imSystem(db, WARTESCHLANGE, auftraege.openDelete),
    waitingTheKind: imSystem(db, WARTESCHLANGE, auftraege.waitingTheKind),
    numbersTheKind: imSystem(db, WARTESCHLANGE, auftraege.numbersTheKind),
    jobList: imSystem(db, MANAGEMENT, auftraege.jobList),
    letzteJeArt: imSystem(db, MANAGEMENT, auftraege.letzteJeArt),
    numbersJeKindAndStatus: imSystem(db, MANAGEMENT, auftraege.numbersJeKindAndStatus),
    runningPauses: imSystem(db, WARTESCHLANGE, auftraege.runningPauses),
    jobStatus: mit(db)(auftraege.jobStatus),
    pullAppointmentsBefore: imSystem(db, WARTESCHLANGE, auftraege.pullAppointmentsBefore),
    writeResult: imSystem(db, WARTESCHLANGE, auftraege.writeResult),
  },
  importStand: {
    markOrphaned: mit(db)(importStand.markOrphaned),
    importStand: mit(db)(importStand.importStand),
    writeImportStatus: mit(db)(importStand.writeImportStatus),
    changeImportStatus: mit(db)(importStand.changeImportStatus),
    setRunFort: mit(db)(importStand.setRunFort),
  },
  laufzustand: {
    liesZustand: mit(db)(laufzustand.liesZustand),
    setzeZustand: mit(db)(laufzustand.setzeZustand),
    deleteState: mit(db)(laufzustand.deleteState),
    countState: mit(db)(laufzustand.countState),
  },
  eigene: {
    ownRow: mit(db)(auftraege.ownRow),
    countRunningRows: mit(db)(auftraege.countRunningRows),
    deleteOwnRow: mit(db)(auftraege.deleteOwnRow),
    deleteEndedRows: imSystem(db, 'Aufräumen über alle Konten', auftraege.deleteEndedRows),
  },
});
export type JobsContext = Kontext<JobsDependencies, ReturnType<typeof zugang>>;
