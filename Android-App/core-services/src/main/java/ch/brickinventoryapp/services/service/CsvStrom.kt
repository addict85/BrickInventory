package ch.brickinventoryapp.services.service

import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.takeWhile

/**
 * Follows the SSE stream until [weiter] returns false (import done: true) or the
 * stream fails (false). A cancellation is passed on, so the service doesn't fall
 * into the fallback and keep polling there while shutting down.
 */
internal suspend fun folgeStrom(
    strom: Flow<CsvImportSseClient.Event>,
    weiter: (CsvImportStatusView) -> Boolean,
): Boolean {
    var gescheitert = false
    fangeAusserAbbruch {
        strom.takeWhile { ev ->
            when (ev) {
                is CsvImportSseClient.Event.Status -> weiter(ev.status)
                is CsvImportSseClient.Event.Failed -> { gescheitert = true; false }
            }
        }.collect { }
    }.onFailure { gescheitert = true }
    return !gescheitert
}
