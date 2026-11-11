package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.data.model.CsvImportStatus
import ch.brickinventoryapp.model.data.model.GenericAdminResponse
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
    fun beobachte(): Flow<CsvImportStatus>

    /** „Ab hier nicht weiter“; schon angelegte Sets bleiben. */
    suspend fun abbrechen(): Ergebnis<GenericAdminResponse>
}

/** Über den SSE-Strom, mit der Statusabfrage als Rückfall. */
class CsvImportBeobachter @Inject constructor(
    private val strom: CsvImportStrom,
    private val dateien: SetDateienRepository,
) : CsvImportRepository {

    override fun beobachte(): Flow<CsvImportStatus> = flow {
        var rueckzugMs = RUECKZUG_START_MS
        while (true) {
            var abgerissen = false
            fangeAusserAbbruch {
                strom.stream().collect { ereignis ->
                    when (ereignis) {
                        is CsvImportSseClient.Event.Status -> {
                            rueckzugMs = RUECKZUG_START_MS
                            emit(ereignis.status)
                        }
                        is CsvImportSseClient.Event.Failed -> abgerissen = true
                    }
                }
            }.onFailure { abgerissen = true }
            if (abgerissen) {
                // Einmal nachsehen, damit der Balken nicht auf dem letzten Stand hängt.
                frageAb()
                delay(rueckzugMs)
                rueckzugMs = minOf(rueckzugMs * 2, RUECKZUG_MAX_MS)
            }
        }
    }

    private suspend fun FlowCollector<CsvImportStatus>.frageAb() {
        val stand = fangeAusserAbbruch { (dateien.getCsvImportStatus() as? Ergebnis.Success)?.data }.getOrNull()
        if (stand != null) emit(stand)
    }

    override suspend fun abbrechen(): Ergebnis<GenericAdminResponse> = dateien.cancelCsvImport()

    private companion object {
        const val RUECKZUG_START_MS = 5_000L
        const val RUECKZUG_MAX_MS = 60_000L
    }
}
