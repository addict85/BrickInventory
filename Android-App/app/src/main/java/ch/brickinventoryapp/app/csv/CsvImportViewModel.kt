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
 * The bar of a running CSV import, also one from the web app. Stream and
 * foreground service are controlled by the [CsvImportCoordinator]; the ViewModel binds it to
 * the activity's lifetime and to the sign-in, instead of a LaunchedEffect.
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

    /** Cancelling means “no further from here”; created sets stay. */
    fun cancelCsvImport() {
        viewModelScope.launch {
            when (val r = csvImport.abbrechen()) {
                is Ergebnis.Erfolg -> meldungen.zeige(Meldung.Resource(R.string.csv_cancel_requested))
                is Ergebnis.Fehler -> meldungen.zeige(texts.meldungFuerSnackbar(r))
            }
        }
    }
}
