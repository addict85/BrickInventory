package ch.brickinventoryapp.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.service.CsvImportService
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.Bestandssignal
import ch.brickinventoryapp.ui.CsvFolge
import ch.brickinventoryapp.ui.CsvImportUiState
import ch.brickinventoryapp.ui.Sitzung
import ch.brickinventoryapp.ui.csvFolge
import ch.brickinventoryapp.ui.importLaeuft
import ch.brickinventoryapp.ui.model.CsvImportStandAnsicht
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.util.fangeAusserAbbruch
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Der Balken eines laufenden CSV-Imports, auch eines aus der Webapp. Eine
 * dauerhafte SSE-Verbindung meldet jeden Schritt; nach dem Abmelden ist sie zu
 * und der Balken leer.
 */
@HiltViewModel
class CsvImportViewModel @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val sseClient: CsvImportSseClient,
    private val repo: BrickRepository,
    private val prefs: PreferencesManager,
    private val texte: Texte,
    private val bestand: Bestandssignal,
    meldungen: MeldungsKanal,
    sitzung: Sitzung,
) : ViewModel() {

    private val _snackbar = meldungen.fluss
    private val _csvImportState = MutableStateFlow(CsvImportUiState())
    val csvImportState: StateFlow<CsvImportUiState> = _csvImportState.asStateFlow()
    private var csvWatchJob: Job? = null

    @Volatile private var csvFinishing = false

    init {
        viewModelScope.launch {
            sitzung.abmeldungen.collect {
                csvWatchJob?.cancel(); csvWatchJob = null
                _csvImportState.value = CsvImportUiState()
            }
        }
    }

    /**
     * Bei Fehlern einmal per Abfrage nachsehen, damit der Balken nicht hängt, und
     * mit wachsendem Abstand neu verbinden. Mehrfach gerufen: ohne Wirkung.
     */
    fun startCsvImportWatcher() {
        if (csvWatchJob?.isActive == true) return
        _csvImportState.value = CsvImportUiState()
        csvWatchJob = viewModelScope.launch {
            var backoffMs = BACKOFF_START_MS
            while (isActive) {
                var sseFailed = false
                fangeAusserAbbruch {
                    sseClient.stream().collect { event ->
                        when (event) {
                            is CsvImportSseClient.Event.Status -> {
                                backoffMs = BACKOFF_START_MS
                                handleCsvStatus(event.status.alsAnsicht())
                            }
                            is CsvImportSseClient.Event.Failed -> { sseFailed = true }
                        }
                    }
                }.onFailure { sseFailed = true }
                if (!isActive) break
                if (sseFailed) {
                    abfrageStattStrom()
                    delay(backoffMs)
                    backoffMs = minOf(backoffMs * 2, BACKOFF_MAX_MS)
                }
                // Sauber geschlossen (Neustart des Servers): sofort neu verbinden.
            }
        }
    }

    /** Abbrechen heisst „ab hier nicht weiter“; angelegte Sets bleiben. */
    fun cancelCsvImport() {
        viewModelScope.launch {
            when (val r = repo.sets.cancelCsvImport()) {
                is Result.Success -> _snackbar.value = texte.text(R.string.csv_cancel_requested)
                is Result.Error -> _snackbar.value = texte.meldungFuerSnackbar(r)
            }
        }
    }

    private suspend fun handleCsvStatus(s: CsvImportStandAnsicht) {
        // Vor dem Überschreiben entscheiden — danach wäre „vorher“ schon der neue Zustand.
        val folge = csvFolge(warVorherAktiv = _csvImportState.value.running, status = s.status)
        if (folge == CsvFolge.DIENST_STARTEN) CsvImportService.start(ctx)
        _csvImportState.value = CsvImportUiState(
            running = importLaeuft(s.status),
            done    = s.done,
            total   = s.total,
            current = s.current,
            ok      = s.ok,
            warn    = s.warn,
            err     = s.err
        )
        when (folge) {
            CsvFolge.NACHLADEN -> finishCsvImport()
            CsvFolge.FEHLER_AUFRAEUMEN -> {
                delay(BALKEN_STEHT_MS)
                _csvImportState.value = CsvImportUiState()
                CsvImportService.stop(ctx)
            }
            CsvFolge.DIENST_STARTEN, CsvFolge.NICHTS -> {}
        }
    }

    /** Fertig: die Galerie lädt nach, der Balken bleibt kurz stehen. */
    private suspend fun finishCsvImport() {
        if (csvFinishing) return
        csvFinishing = true
        try {
            bestand.melde(Aenderung.Sets)
            delay(BALKEN_STEHT_MS)
            _csvImportState.value = CsvImportUiState()
            CsvImportService.stop(ctx)
        } finally {
            csvFinishing = false
        }
    }

    private suspend fun abfrageStattStrom() {
        fangeAusserAbbruch {
            val url = prefs.serverUrlJetzt()
            val token = prefs.tokenJetzt()
            if (token.isBlank() || url.isBlank()) return
            val resp = repo.sets.getCsvImportStatus(url, token)
            if (resp is Result.Success) handleCsvStatus(resp.data.alsAnsicht())
        }
    }

    private companion object {
        const val BACKOFF_START_MS = 5_000L
        const val BACKOFF_MAX_MS = 60_000L
        const val BALKEN_STEHT_MS = 5_000L
    }
}
