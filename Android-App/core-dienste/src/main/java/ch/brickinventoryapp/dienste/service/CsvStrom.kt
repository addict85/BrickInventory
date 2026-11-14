package ch.brickinventoryapp.dienste.service

import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.vertrag.CsvImportStatus
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.takeWhile

/**
 * Folgt dem SSE-Strom, bis [weiter] false liefert (Import fertig: true) oder der
 * Strom scheitert (false). Ein Abbruch geht weiter, damit der Dienst beim Beenden
 * nicht in die Rückfallebene läuft und dort weiterpollt.
 */
internal suspend fun folgeStrom(
    strom: Flow<CsvImportSseClient.Event>,
    weiter: (CsvImportStatus) -> Boolean,
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
