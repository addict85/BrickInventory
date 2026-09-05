package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.Result
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

/**
 * Einen laufenden CSV-Import abbrechen.
 *
 * ── Warum es das jetzt gibt (Nachtrag 134) ──────────────────────────────────
 *
 * Die Webapp hat den Knopf seit jeher (02-gallery.js, `cancelImport` am
 * `btn-cancel-import`). Die App zeigte denselben Fortschrittsbalken — und
 * keinen Weg heraus. Ein versehentlich gestarteter Import ueber hunderte Sets
 * holt zu jedem einzelnen die Stammdaten; wer ihn am Telefon anstiess, musste
 * ihn aussitzen.
 *
 * Gefunden durch Messen: Ein Vergleich der Server-Adressen beider Clients
 * meldete /v1/sets/import/csv/cancel als eine von 21 Adressen, die nur die
 * Webapp ruft.
 *
 * ── Was Abbrechen NICHT tut ─────────────────────────────────────────────────
 *
 * Der Server vermerkt `status: 'cancelled'`; die Schleife im Import sieht das
 * beim naechsten Satz und hoert auf. Schon angelegte Sets BLEIBEN. Das ist in
 * der Webapp genauso, und es ist die richtige Bedeutung: „ab hier nicht
 * weiter", nicht „rueckgaengig".
 *
 * Der Balken verschwindet nicht hier, sondern beim naechsten Statusereignis —
 * dieselbe Quelle wie sonst auch. Ihn sofort auszublenden hiesse, den Erfolg
 * zu behaupten, bevor der Server ihn bestaetigt hat.
 */
internal fun MainViewModel.cancelCsvImport() {
    viewModelScope.launch {
        when (val r = repo.sets.cancelCsvImport()) {
            is Result.Success -> _snackbar.value = text(R.string.csv_cancel_requested)
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}
