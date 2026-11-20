package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.fach.CsvImportStatusView
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import javax.inject.Inject

/** Der Stand eines CSV-Imports, auch eines aus der Webapp. */
interface CsvImportRepository {
    /**
     * Jeder Stand, solange jemand sammelt. Reisst der Strom ab, wird einmal abgefragt
     * und mit wachsendem Abstand neu verbunden; schliesst der Server sauber, sofort.
     */
    fun observe(): Flow<CsvImportStatusView>

    /** „Ab hier nicht weiter“; schon angelegte Sets bleiben. */
    suspend fun abbrechen(): Ergebnis<Unit>
}

/** Über den SSE-Strom, mit der Statusabfrage als Rückfall. */
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
                // Einmal nachsehen, damit der Balken nicht auf dem letzten Stand hängt.
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
