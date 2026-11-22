package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.collection.SetFilesRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import javax.inject.Inject

/** The state of a CSV import, also one from the web app. */
interface CsvImportRepository {
    /**
     * Every state as long as someone collects. If the stream breaks, it queries once
     * and reconnects with growing delay; if the server closes cleanly, immediately.
     */
    fun observe(): Flow<CsvImportStatusView>

    /** „No further from here“; sets already created stay. */
    suspend fun cancel(): Outcome<Unit>
}

/** Via the SSE stream, with the status query as fallback. */
class CsvImportObserver @Inject constructor(
    private val stream: CsvImportStream,
    private val files: SetFilesRepository,
) : CsvImportRepository {

    override fun observe(): Flow<CsvImportStatusView> = flow {
        var retreatMs = RETREAT_START_MS
        while (true) {
            var tornDown = false
            catchUnlessCancelled {
                stream.stream().collect { event ->
                    when (event) {
                        is CsvImportSseClient.Event.Status -> {
                            retreatMs = RETREAT_START_MS
                            emit(event.status)
                        }
                        is CsvImportSseClient.Event.Failed -> tornDown = true
                    }
                }
            }.onFailure { tornDown = true }
            if (tornDown) {
                // Look once so that the bar does not hang on the last state.
                poll()
                delay(retreatMs)
                retreatMs = minOf(retreatMs * 2, RETREAT_MAX_MS)
            }
        }
    }

    /** A failed look is no state: the bar keeps the last one, and the stream is retried with back-off. */
    private suspend fun FlowCollector<CsvImportStatusView>.poll() {
        when (val r = catchUnlessCancelled { files.getCsvImportStatus() }.getOrNull()) {
            is Outcome.Success -> emit(r.data)
            is Outcome.Failure, null -> Unit
        }
    }

    override suspend fun cancel(): Outcome<Unit> = files.cancelCsvImport()

    private companion object {
        const val RETREAT_START_MS = 5_000L
        const val RETREAT_MAX_MS = 60_000L
    }
}
