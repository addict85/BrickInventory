package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.service.CsvImportDienst
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.Bestandssignal
import ch.brickinventoryapp.ui.CsvFolge
import ch.brickinventoryapp.ui.CsvImportUiState
import ch.brickinventoryapp.ui.Sitzung
import ch.brickinventoryapp.ui.csvFolge
import ch.brickinventoryapp.ui.importLaeuft
import ch.brickinventoryapp.ui.model.CsvImportStandAnsicht
import ch.brickinventoryapp.ui.model.alsAnsicht
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Der Balken eines laufenden CSV-Imports, auch eines aus der Webapp. Den Strom samt
 * Wiederverbindung liefert die Datenschicht ([CsvImportRepository]); hier wird aus
 * jedem Stand der Balken. Nach dem Abmelden ist die Verbindung zu und der Balken leer.
 */
@HiltViewModel
class CsvImportViewModel @Inject constructor(
    private val csvImport: CsvImportRepository,
    private val dienst: CsvImportDienst,
    private val texte: Texte,
    private val bestand: Bestandssignal,
    private val meldungen: MeldungsKanal,
    sitzung: Sitzung,
) : ViewModel() {

    private val _csvImportState = MutableStateFlow(CsvImportUiState())
    val csvImportState: StateFlow<CsvImportUiState> = _csvImportState.asStateFlow()
    private var csvWatchJob: Job? = null

    @Volatile private var csvFinishing = false

    init {
        folgeAbmeldung(sitzung) {
            csvWatchJob?.cancel(); csvWatchJob = null
            _csvImportState.value = CsvImportUiState()
        }
    }

    /** Mehrfach gerufen: ohne Wirkung. */
    fun startCsvImportWatcher() {
        if (csvWatchJob?.isActive == true) return
        _csvImportState.value = CsvImportUiState()
        csvWatchJob = viewModelScope.launch {
            csvImport.beobachte().collect { handleCsvStatus(it.alsAnsicht()) }
        }
    }

    /** Abbrechen heisst „ab hier nicht weiter“; angelegte Sets bleiben. */
    fun cancelCsvImport() {
        viewModelScope.launch {
            when (val r = csvImport.abbrechen()) {
                is Ergebnis.Success -> meldungen.zeige(texte.text(R.string.csv_cancel_requested))
                is Ergebnis.Error -> meldungen.zeige(texte.meldungFuerSnackbar(r))
            }
        }
    }

    private suspend fun handleCsvStatus(s: CsvImportStandAnsicht) {
        // Vor dem Überschreiben entscheiden — danach wäre „vorher“ schon der neue Zustand.
        val folge = csvFolge(warVorherAktiv = _csvImportState.value.running, status = s.status)
        if (folge == CsvFolge.DIENST_STARTEN) dienst.start()
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
                dienst.stop()
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
            dienst.stop()
        } finally {
            csvFinishing = false
        }
    }

    private companion object {
        const val BALKEN_STEHT_MS = 5_000L
    }
}
