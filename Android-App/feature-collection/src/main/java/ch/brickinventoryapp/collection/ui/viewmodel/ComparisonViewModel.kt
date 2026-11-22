package ch.brickinventoryapp.collection.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import java.io.Serializable
import javax.inject.Inject

/**
 * The price comparison page: a set number typed or a barcode scanned. [pendingQuery] is
 * the search the page still has to open in the browser; it acknowledges it with [queryOpened],
 * so a rotation does not open it twice.
 */
data class ComparisonUiState(
    val searchText: String = "",
    val scannedBarcode: String? = null,
    val showScanner: Boolean = false,
    val pendingQuery: String? = null,
) : Serializable {
    val canSearch: Boolean get() = searchText.isNotBlank() || scannedBarcode != null

    /** The scanned code is shown as long as nothing was typed over it. */
    val showsBarcode: Boolean get() = scannedBarcode != null && searchText.isBlank()

    private companion object {
        private const val serialVersionUID: Long = 1L
    }
}

/** What the comparison page triggers; the screen knows only this interface. */
interface ComparisonActions {
    fun setSearch(text: String)
    fun clearSearch()
    fun openScanner()
    fun closeScanner()
    fun scanned(barcode: String)
    fun search()
    fun queryOpened()
}

@HiltViewModel
internal class ComparisonViewModel @Inject constructor(private val saved: SavedStateHandle) : ViewModel(), ComparisonActions {

    // Typed text and scanner survive a process death; a query not yet opened does not reopen afterwards.
    val state: StateFlow<ComparisonUiState> = saved.getStateFlow(KEY, ComparisonUiState())

    private fun update(f: (ComparisonUiState) -> ComparisonUiState) {
        saved[KEY] = f(state.value)
    }

    /** [text] comes filtered from the field (digits and hyphen); typing replaces a scanned code. */
    override fun setSearch(text: String) = update {
        it.copy(searchText = text, scannedBarcode = if (text.isNotBlank()) null else it.scannedBarcode)
    }

    override fun clearSearch() = update { it.copy(searchText = "") }
    override fun openScanner() = update { it.copy(showScanner = true) }
    override fun closeScanner() = update { it.copy(showScanner = false) }

    override fun scanned(barcode: String) =
        update { it.copy(scannedBarcode = barcode, searchText = "", showScanner = false, pendingQuery = barcode) }

    /** The typed text wins over an earlier scan; without either there is nothing to search. */
    override fun search() = update {
        it.copy(pendingQuery = it.searchText.trim().takeIf(String::isNotEmpty) ?: it.scannedBarcode)
    }

    override fun queryOpened() = update { it.copy(pendingQuery = null) }

    private companion object {
        const val KEY = "comparison"
    }
}
