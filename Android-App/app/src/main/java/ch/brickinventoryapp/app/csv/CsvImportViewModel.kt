package ch.brickinventoryapp.app.csv

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Der Balken eines laufenden CSV-Imports, auch eines aus der Webapp. Strom und
 * Vordergrund-Dienst steuert der [CsvImportKoordinator]; das ViewModel bindet ihn an
 * die Lebenszeit der Activity und an die Anmeldung, statt eines LaunchedEffect.
 */
@HiltViewModel
class CsvImportViewModel @Inject constructor(
    private val koordinator: CsvImportKoordinator,
    private val csvImport: CsvImportRepository,
    private val texte: Texte,
    private val meldungen: MeldungsKanal,
    sitzung: Sitzung,
) : ViewModel() {

    val csvImportState: StateFlow<CsvImportUiState> = koordinator.zustand

    init {
        viewModelScope.launch { koordinator.folge(sitzung.state.map { it.isLoggedIn }) }
    }

    /** Abbrechen heisst „ab hier nicht weiter“; angelegte Sets bleiben. */
    fun cancelCsvImport() {
        viewModelScope.launch {
            when (val r = csvImport.abbrechen()) {
                is Ergebnis.Success -> meldungen.zeige(Meldung.Ressource(R.string.csv_cancel_requested))
                is Ergebnis.Error -> meldungen.zeige(texte.meldungFuerSnackbar(r))
            }
        }
    }
}
