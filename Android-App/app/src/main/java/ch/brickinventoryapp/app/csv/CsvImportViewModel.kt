package ch.brickinventoryapp.app.csv

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Der Balken eines laufenden CSV-Imports, auch eines aus der Webapp. Strom und
 * Vordergrund-Dienst steuert der [CsvImportCoordinator]; das ViewModel bindet ihn an
 * die Lebenszeit der Activity und an die Anmeldung, statt eines LaunchedEffect.
 */
@HiltViewModel
class CsvImportViewModel @Inject constructor(
    private val coordinator: CsvImportCoordinator,
    private val csvImport: CsvImportRepository,
    private val texts: Texte,
    private val meldungen: MeldungsKanal,
    sitzung: Sitzung,
) : ViewModel() {

    val csvImportState: StateFlow<CsvImportUiState> = coordinator.zustand

    init {
        viewModelScope.launch { coordinator.sequence(sitzung.state.map { it.isLoggedIn }) }
    }

    /** Abbrechen heisst „ab hier nicht weiter“; angelegte Sets bleiben. */
    fun cancelCsvImport() {
        viewModelScope.launch {
            when (val r = csvImport.abbrechen()) {
                is Ergebnis.Erfolg -> meldungen.zeige(Meldung.Resource(R.string.csv_cancel_requested))
                is Ergebnis.Fehler -> meldungen.zeige(texts.meldungFuerSnackbar(r))
            }
        }
    }
}
