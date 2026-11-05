package ch.brickinventoryapp.ui.viewmodel

import ch.brickinventoryapp.util.fangeAusserAbbruch
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.DownloadGescheitert
import ch.brickinventoryapp.ui.pdf.PdfFehler
import ch.brickinventoryapp.ui.pdf.PdfHalter
import ch.brickinventoryapp.ui.pdf.PdfLader
import ch.brickinventoryapp.ui.pdf.PdfLoadState
import ch.brickinventoryapp.ui.pdf.PdfSeitenQuelle
import ch.brickinventoryapp.ui.pdf.PdfSchreiber
import ch.brickinventoryapp.ui.pdf.kopiereAbbrechbar
import ch.brickinventoryapp.di.BrickDispatchers
import ch.brickinventoryapp.di.Dispatcher
import ch.brickinventoryapp.util.pdfImBetrachter
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * Der Ladezustand des PDF-Betrachters. Im ViewModel, weil eine Drehung die Komposition
 * neu baut: Ein Download von bis zu 300 MB begänne sonst von vorn, ein Gutschein-PDF
 * im Speicher ginge ganz verloren. Die Quelle schliesst erst das Verlassen.
 */
@HiltViewModel
class PdfBetrachterViewModel @Inject constructor(
    private val lader: PdfLader,
    /** Rendert die Seiten für den Bildschirm; hier nur durchgereicht. */
    val seiten: PdfSeitenQuelle,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : ViewModel() {

    private val _state = MutableStateFlow<PdfLoadState>(PdfLoadState.Downloading(0, 0, 0))
    val state: StateFlow<PdfLoadState> = _state.asStateFlow()

    private val offen = PdfHalter()
    private var adresse: String? = null

    /** Für jede Komposition gerufen; dieselbe Adresse lädt nur einmal. */
    fun oeffne(pdfUrl: String, serverUrl: String) {
        val bisher = _state.value
        val abgewiesen = bisher is PdfLoadState.Error && bisher.grund == PdfFehler.FREMDER_HOST
        if (pdfUrl == adresse && !abgewiesen) return
        adresse = pdfUrl
        // Nur Adressen des eigenen Servers: Geladen wird mit dem Token-Client.
        if (!pdfImBetrachter(pdfUrl, serverUrl)) {
            _state.value = PdfLoadState.Error(null, PdfFehler.FREMDER_HOST)
            return
        }
        _state.value = PdfLoadState.Downloading(0, 0, 0)
        viewModelScope.launch {
            _state.value = fangeAusserAbbruch { lader.lade(pdfUrl, offen) { _state.value = it } }.fold(
                onSuccess = { (quelle, seiten) -> PdfLoadState.Ready(quelle, seiten) },
                onFailure = { e ->
                    if (e is DownloadGescheitert) PdfLoadState.Error(null, PdfFehler.DOWNLOAD) else PdfLoadState.Error(e.message)
                },
            )
        }
    }

    /** Kopiert die geladene Datei für den Druck auf dem IO-Dispatcher; abbrechbar zwischen zwei Stücken. */
    val schreiber = PdfSchreiber { quelle, ziel -> withContext(io) { quelle.eingang().use { kopiereAbbrechbar(it, ziel) } } }

    override fun onCleared() {
        offen.close()
    }
}
