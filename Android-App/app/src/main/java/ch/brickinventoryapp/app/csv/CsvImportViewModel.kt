package ch.brickinventoryapp.app.csv

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.dataapi.message.MessageChannel
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.model.text.Message
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The bar of a running CSV import, also one from the web app. Stream and
 * background follow-up are controlled by the [CsvImportCoordinator]; the ViewModel binds it to
 * the activity's lifetime and to the sign-in, instead of a LaunchedEffect.
 */
@HiltViewModel
class CsvImportViewModel @Inject constructor(
    private val coordinator: CsvImportCoordinator,
    private val csvImport: CsvImportRepository,
    private val texts: Texts,
    private val messages: MessageChannel,
    session: Session,
) : ViewModel() {

    val csvImportState: StateFlow<CsvImportUiState> = coordinator.uiState

    init {
        viewModelScope.launch { coordinator.sequence(session.state.map { it.isLoggedIn }) }
    }

    /** Cancelling means “no further from here”; created sets stay. */
    fun cancelCsvImport() {
        viewModelScope.launch {
            when (val r = csvImport.cancel()) {
                is Outcome.Success -> messages.show(Message.Resource(R.string.csv_cancel_requested))
                is Outcome.Failure -> messages.show(texts.messageForSnackbar(r))
            }
        }
    }
}
