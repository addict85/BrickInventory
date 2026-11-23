package ch.brickinventoryapp.finances.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.DownloadFailed
import ch.brickinventoryapp.finances.ui.pdf.PdfError
import ch.brickinventoryapp.finances.ui.pdf.PdfHolder
import ch.brickinventoryapp.finances.ui.pdf.PdfLoadState
import ch.brickinventoryapp.finances.ui.pdf.PdfLoader
import ch.brickinventoryapp.finances.ui.pdf.PdfPagesSource
import ch.brickinventoryapp.finances.ui.pdf.PdfWriter
import ch.brickinventoryapp.finances.ui.pdf.copyCancellable
import ch.brickinventoryapp.finances.ui.pdf.pdfErrorClass
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.model.util.catchUnlessCancelled
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
internal class PdfViewerViewModel @Inject constructor(
    private val loader: PdfLoader,
    /** Renders the pages for the screen; only passed through here. */
    val pages: PdfPagesSource,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : ViewModel() {

    private val _state = MutableStateFlow<PdfLoadState>(PdfLoadState.Downloading(0, 0, 0))
    val state: StateFlow<PdfLoadState> = _state.asStateFlow()

    private val open = PdfHolder()
    private var address: String? = null
    private var server: String = ""

    /** Called for every composition; the same address loads only once. */
    fun open(pdfUrl: String, serverUrl: String) {
        val previous = _state.value
        val rejected = previous is PdfLoadState.Error && previous.reason == PdfError.FOREIGN_HOST
        if (pdfUrl == address && !rejected) return
        address = pdfUrl
        server = serverUrl
        // Only addresses of our own server: loaded with the token client.
        if (!pdfInViewer(pdfUrl, serverUrl)) {
            _state.value = PdfLoadState.Error(null, PdfError.FOREIGN_HOST)
            return
        }
        _state.value = PdfLoadState.Downloading(0, 0, 0)
        viewModelScope.launch {
            _state.value = catchUnlessCancelled { loader.load(pdfUrl, open) { _state.value = it } }.fold(
                onSuccess = { (source, pages) -> PdfLoadState.Ready(source, pages) },
                onFailure = { e ->
                    if (e is DownloadFailed && e.status == null) PdfLoadState.Error(null, PdfError.DOWNLOAD)
                    else PdfLoadState.Error(e.message, kind = pdfErrorClass(e))
                },
            )
        }
    }

    /** „Erneut versuchen“ in the error state: the same address once more, which otherwise loads only once. */
    fun again() {
        val previous = address ?: return
        if (_state.value !is PdfLoadState.Error) return
        address = null
        open(previous, server)
    }

    /** Copies the loaded file for printing on the IO dispatcher; cancellable between two chunks. */
    val writer = PdfWriter { source, target -> withContext(io) { source.inbox().use { copyCancellable(it, target) } } }

    override fun onCleared() {
        open.close()
    }
}
