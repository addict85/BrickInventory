package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.domain.Laufstatus
/**
 * What follows from a CSV status message? Separate from CsvImportCoordinator, which
 * acts: the decision needs neither service nor time and can thus be checked as a
 * table (CsvStatusReloadTest).
 */
internal enum class CsvSequence {
    /** An import has just begun — the foreground service must start. */
    DIENST_STARTEN,

    /** A running import has finished — reload data once. */
    NACHLADEN,

    /** The import has failed — show the banner briefly, then clean up. */
    FEHLER_AUFRAEUMEN,

    /** Nothing to do: no transition, only a repetition of the state. */
    NICHTS
}

/**
 * Is an import running according to this message?
 *
 * `pending` counts too: the job is accepted, the user should already see the banner
 * and the service should already run — otherwise the app seems frozen between
 * acceptance and the first line.
 */
internal fun importRunning(status: Laufstatus?): Boolean = status?.laeuft == true

/**
 * The actual rule: reloading happens on the transition from “running” to “finished”, not in
 * every “finished” state.
 */
internal fun csvSequence(warBeforeActive: Boolean, status: Laufstatus?): CsvSequence = when {
    // Running: start the service only on startup, not on every progress line.
    importRunning(status) -> if (warBeforeActive) CsvSequence.NICHTS else CsvSequence.DIENST_STARTEN

    // An error is reported as long as it is pending — here the cleanup is
    // intentionally idempotent and not bound to the transition.
    status == Laufstatus.FEHLER -> CsvSequence.FEHLER_AUFRAEUMEN

    status == null -> CsvSequence.NICHTS

    // Finished — but only reload if something really ran before.
    warBeforeActive -> CsvSequence.NACHLADEN

    else -> CsvSequence.NICHTS
}
