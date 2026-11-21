package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
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
    suspend fun abbrechen(): Ergebnis<Unit>
}

/** Via the SSE stream, with the status query as fallback. */
class CsvImportObserver @Inject constructor(
    private val strom: CsvImportStream,
    private val dateien: SetDateienRepository,
) : CsvImportRepository {

    override fun observe(): Flow<CsvImportStatusView> = flow {
        var retreatMs = RETREAT_START_MS
        while (true) {
            var tornDown = false
            fangeAusserAbbruch {
                strom.stream().collect { event ->
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
                questionAb()
                delay(retreatMs)
                retreatMs = minOf(retreatMs * 2, RETREAT_MAX_MS)
            }
        }
    }

    private suspend fun FlowCollector<CsvImportStatusView>.questionAb() {
        val stand = fangeAusserAbbruch { (dateien.getCsvImportStatus() as? Ergebnis.Erfolg)?.data }.getOrNull()
        if (stand != null) emit(stand)
    }

    override suspend fun abbrechen(): Ergebnis<Unit> = dateien.cancelCsvImport()

    private companion object {
        const val RETREAT_START_MS = 5_000L
        const val RETREAT_MAX_MS = 60_000L
    }
}
