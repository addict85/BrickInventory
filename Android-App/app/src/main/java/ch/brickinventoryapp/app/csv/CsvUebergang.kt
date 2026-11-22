package ch.brickinventoryapp.app.csv

import ch.brickinventoryapp.model.domain.RunStatus
/**
 * What follows from a CSV status message? Separate from CsvImportCoordinator, which
 * acts: the decision needs neither service nor time and can thus be checked as a
 * table (CsvStatusReloadTest).
 */
internal enum class CsvSequence {
    /** An import has just begun — the foreground service must start. */
    SERVICE_START,

    /** A running import has finished — reload data once. */
    RELOAD,

    /** The import has failed — show the banner briefly, then clean up. */
    ERROR_CLEAN_UP,

    /** Nothing to do: no transition, only a repetition of the state. */
    NOTHING
}

/**
 * Is an import running according to this message?
 *
 * `pending` counts too: the job is accepted, the user should already see the banner
 * and the service should already run — otherwise the app seems frozen between
 * acceptance and the first line.
 */
internal fun importRunning(status: RunStatus?): Boolean = status?.running == true

/**
 * The actual rule: reloading happens on the transition from “running” to “finished”, not in
 * every “finished” state.
 */
internal fun csvSequence(wasBeforeActive: Boolean, status: RunStatus?): CsvSequence = when {
    // Running: start the service only on startup, not on every progress line.
    importRunning(status) -> if (wasBeforeActive) CsvSequence.NOTHING else CsvSequence.SERVICE_START

    // An error is reported as long as it is pending — here the cleanup is
    // intentionally idempotent and not bound to the transition.
    status == RunStatus.ERROR -> CsvSequence.ERROR_CLEAN_UP

    status == null -> CsvSequence.NOTHING

    // Finished — but only reload if something really ran before.
    wasBeforeActive -> CsvSequence.RELOAD

    else -> CsvSequence.NOTHING
}
