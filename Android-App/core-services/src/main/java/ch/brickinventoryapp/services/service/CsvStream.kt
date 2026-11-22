package ch.brickinventoryapp.services.service

import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.takeWhile

/**
 * Follows the SSE stream until [next] returns false (import done: true) or the
 * stream fails (false). A cancellation is passed on, so the service doesn't fall
 * into the fallback and keep polling there while shutting down.
 */
internal suspend fun followStream(
    stream: Flow<CsvImportSseClient.Event>,
    next: (CsvImportStatusView) -> Boolean,
): Boolean {
    var failed = false
    catchUnlessCancelled {
        stream.takeWhile { ev ->
            when (ev) {
                is CsvImportSseClient.Event.Status -> next(ev.status)
                is CsvImportSseClient.Event.Failed -> { failed = true; false }
            }
        }.collect { }
    }.onFailure { failed = true }
    return !failed
}
