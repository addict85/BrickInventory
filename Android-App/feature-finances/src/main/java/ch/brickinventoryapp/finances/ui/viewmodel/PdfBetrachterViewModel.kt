package ch.brickinventoryapp.finances.ui.viewmodel

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.DownloadFailed
import ch.brickinventoryapp.finances.ui.pdf.PdfError
import ch.brickinventoryapp.finances.ui.pdf.PdfHolder
import ch.brickinventoryapp.finances.ui.pdf.PdfLoader
import ch.brickinventoryapp.finances.ui.pdf.PdfLoadState
import ch.brickinventoryapp.finances.ui.pdf.PdfSeitenQuelle
import ch.brickinventoryapp.finances.ui.pdf.PdfSchreiber
import ch.brickinventoryapp.finances.ui.pdf.copyAbbrechbar
import ch.brickinventoryapp.finances.ui.pdf.pdfErrorClass
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.network.util.pdfInViewer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * The loading state of the PDF viewer. In the ViewModel, because a rotation rebuilds the
 * composition: a download of up to 300 MB would otherwise start over, a voucher PDF
 * in memory would be lost entirely. Only leaving closes the source.
 */
@HiltViewModel
class PdfBetrachterViewModel @Inject constructor(
    private val lader: PdfLoader,
    /** Renders the pages for the screen; only passed through here. */
    val pages: PdfSeitenQuelle,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : ViewModel() {

    private val _state = MutableStateFlow<PdfLoadState>(PdfLoadState.Downloading(0, 0, 0))
    val state: StateFlow<PdfLoadState> = _state.asStateFlow()

    private val offen = PdfHolder()
    private var adresse: String? = null
    private var server: String = ""

    /** Called for every composition; the same address loads only once. */
    fun oeffne(pdfUrl: String, serverUrl: String) {
        val bisher = _state.value
        val abgewiesen = bisher is PdfLoadState.Error && bisher.grund == PdfError.FREMDER_HOST
        if (pdfUrl == adresse && !abgewiesen) return
        adresse = pdfUrl
        server = serverUrl
        // Only addresses of our own server: loaded with the token client.
        if (!pdfInViewer(pdfUrl, serverUrl)) {
            _state.value = PdfLoadState.Error(null, PdfError.FREMDER_HOST)
            return
        }
        _state.value = PdfLoadState.Downloading(0, 0, 0)
        viewModelScope.launch {
            _state.value = fangeAusserAbbruch { lader.lade(pdfUrl, offen) { _state.value = it } }.fold(
                onSuccess = { (quelle, pages) -> PdfLoadState.Ready(quelle, pages) },
                onFailure = { e ->
                    if (e is DownloadFailed && e.status == null) PdfLoadState.Error(null, PdfError.DOWNLOAD)
                    else PdfLoadState.Error(e.message, klasse = pdfErrorClass(e))
                },
            )
        }
    }

    /** „Erneut versuchen“ in the error state: the same address once more, which otherwise loads only once. */
    fun erneut() {
        val bisher = adresse ?: return
        if (_state.value !is PdfLoadState.Error) return
        adresse = null
        oeffne(bisher, server)
    }

    /** Copies the loaded file for printing on the IO dispatcher; cancellable between two chunks. */
    val schreiber = PdfSchreiber { quelle, ziel -> withContext(io) { quelle.inbox().use { copyAbbrechbar(it, ziel) } } }

    override fun onCleared() {
        offen.close()
    }
}
