package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch


/**
 * CSV-Import: SSE-Watcher, der den CsvImportUiState-Flow speist.
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

/**
 * Startet den persistenten SSE-Watcher. Idempotent — mehrfache Aufrufe
 * beim gleichen Login-Zustand haben keinen Effekt.
 */
internal fun MainViewModel.startCsvImportWatcher() {
    if (csvWatchJob?.isActive == true) return
    csvWatchJob = viewModelScope.launch {
        var backoffMs = 5_000L
        while (isActive) {
            var sseFailed = false
            try {
                sseClient.stream().collect { event ->
                    when (event) {
                        is CsvImportSseClient.Event.Status -> {
                            backoffMs = 5_000L // Verbindung klappt → Reset
                            handleCsvStatus(event.status)
                        }
                        is CsvImportSseClient.Event.Failed -> {
                            sseFailed = true
                        }
                    }
                }
            } catch (_: Exception) {
                sseFailed = true
            }

            if (!isActive) break

            if (sseFailed) {
                // SSE-Fehler: kurz über Polling-Fallback den aktuellen
                // Stand holen, damit der Banner nicht hängt.
                runCatchingPollingFallback()
                // Dann mit Backoff reconnecten (max 60s).
                kotlinx.coroutines.delay(backoffMs)
                backoffMs = minOf(backoffMs * 2, 60_000L)
            }
            // Server hat Verbindung sauber geschlossen (Neustart/Deploy)
            // → sofort reconnecten, kein Backoff nötig.
        }
    }
}
