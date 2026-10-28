package ch.brickinventoryapp.ui.viewmodel

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.alarm.Alarmeingabe
import ch.brickinventoryapp.data.model.GenericResponse
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.Preisalarmeingabe
import ch.brickinventoryapp.ui.SetDetailUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Wie gross eine Anleitung sein darf — derselbe Wert wie `limits.fileSize` in
 * routes/sets.ts. Die App muss die Grenze kennen, bevor sie 80 MB durchs
 * Mobilfunknetz schickt.
 */
internal const val ANLEITUNG_MAX_BYTES = 50L * 1024 * 1024

/**
 * Die Typen, die der Server annimmt (INSTR_EXT_BY_MIME in routes/sets.ts). Er
 * leitet daraus die Dateiendung ab; die App filtert schon die Auswahl.
 */
internal val ANLEITUNG_TYPEN = arrayOf("application/pdf", "image/jpeg", "image/png")

/**
 * Die Detailansicht eines Sets: Stammdaten, Preis und Verlauf, Käufe,
 * Preisalarme, Anleitungen, Menge und Lagerort.
 *
 * Welches Set, steht im [SavedStateHandle] (Navigationsargument `setNumber`):
 * Nach einem Prozess-Tod öffnet die Ansicht wieder dasselbe Set.
 */
@HiltViewModel
class SetDetailViewModel @Inject constructor(
    dienste: AppDienste,
    private val sets: SetsRepository,
    private val finanzen: FinanzenRepository,
    private val haushalt: HaushaltRepository,
    private val leser: DateiLeser,
    gemerkt: SavedStateHandle,
) : BereichsViewModel(dienste) {

    /** Aus der Route set_detail/{setNumber}. */
    val setNumber: String = gemerkt[ARG_SET] ?: ""

    private val _setDetailState = MutableStateFlow(SetDetailUiState())
    val setDetailState: StateFlow<SetDetailUiState> = _setDetailState.asStateFlow()

    // Menge, Lagerort und Alarm warten die Ruhezeit ab; die Aufträge laufen im
    // Scope des ViewModels und überstehen so das Zurückgehen.
    private var lagerJob: Job? = null
    private val alarmEingabe = Preisalarmeingabe(
        scope = viewModelScope, sets = sets,
        melde = { _snackbar.value = it },
        beschreibe = { meldungFuerSnackbar(it) },
        // Nachgeladen wird in beiAenderung(): Dort kommt dasselbe Signal auch
        // an, wenn ein Alarm anderswo (Übersicht, Merkliste) geändert wurde.
        gespeichert = { dienste.bestand.melde(Aenderung.Alarme) },
    )

    /** Alles, was die Ansicht zeigt — beim Betreten und nach der Rückkehr. */
    fun ladeAlles() {
        if (setNumber.isBlank()) return
        loadSetDetail(setNumber)
        loadSetPrice(setNumber)
        loadSetPriceHistory(setNumber)
        loadAcquisitions(setNumber)
        loadPreisalarme(setNumber)
    }

    fun loadSetDetail(setNumber: String) {
        viewModelScope.launch {
            _setDetailState.update { it.copy(setDetailLoading = true) }
            when (val r = sets.getSetDetail(setNumber)) {
                is Result.Success -> _setDetailState.update { it.copy(setDetail = r.data.set, setDetailLoading = false) }
                is Result.Error -> _setDetailState.update { it.copy(setDetailLoading = false) }
            }
        }
    }

    fun loadSetPrice(setNumber: String) {
        viewModelScope.launch {
            _setDetailState.update { it.copy(setPriceLoading = true) }
            when (val r = finanzen.getSetPrice(setNumber)) {
                is Result.Success -> _setDetailState.update { it.copy(setPrice = r.data, setPriceLoading = false) }
                is Result.Error -> _setDetailState.update { it.copy(setPriceLoading = false) }
            }
        }
    }

    fun loadSetPriceHistory(setNumber: String) {
        viewModelScope.launch {
            _setDetailState.update { it.copy(priceHistoryLoading = true) }
            when (val r = finanzen.getSetPriceHistory(setNumber)) {
                is Result.Success -> _setDetailState.update { it.copy(priceHistory = r.data, priceHistoryLoading = false) }
                is Result.Error -> _setDetailState.update { it.copy(priceHistoryLoading = false) }
            }
        }
    }

    fun loadAcquisitions(setNumber: String) {
        viewModelScope.launch {
            _setDetailState.update { it.copy(acquisitionsLoading = true) }
            when (val r = haushalt.getAcquisitions(setNumber)) {
                is Result.Success -> _setDetailState.update {
                    it.copy(acquisitions = r.data.acquisitions, acquisitionTotals = r.data.totals,
                            acquisitionsLoading = false)
                }
                is Result.Error -> _setDetailState.update { it.copy(acquisitionsLoading = false) }
            }
        }
    }

    fun loadPreisalarme(setNumber: String) {
        viewModelScope.launch {
            val r = sets.getPreisalarme(setNumber)
            val alarme = (r as? Result.Success)?.data?.takeIf { it.success }?.alerts ?: emptyList()
            _setDetailState.update { it.copy(preisalarme = alarme) }
        }
    }

    fun setzePreisalarm(setNumber: String, richtung: String, roh: String, zustand: String) =
        alarmEingabe.setze(setNumber, richtung, roh, zustand)

    /**
     * Die Menge ändern. Die neue Zahl steht sofort in der Ansicht, die übrigen
     * Bestandsansichten erfahren es über das Signal.
     */
    fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: String? = null) =
        mengeAendern(setNumber) { sets.updateQuantity(setNumber, quantity, purchasePrice, condition) }

    /** Der Regler: ein Schritt, damit gleichzeitige Klicks auf zwei Geräten zusammenzählen. */
    fun aendereMengeUm(setNumber: String, schritt: Int) =
        mengeAendern(setNumber) { sets.aendereMengeUm(setNumber, schritt) }

    private fun mengeAendern(setNumber: String, aufruf: suspend () -> Result<GenericResponse>) {
        viewModelScope.launch {
            when (val r = aufruf()) {
                is Result.Success -> {
                    r.data.quantity?.let { echt ->
                        _setDetailState.update { st ->
                            if (st.setDetail?.setNumber == setNumber)
                                st.copy(setDetail = st.setDetail.copy(quantity = echt)) else st
                        }
                    }
                    dienste.bestand.melde(Aenderung.Sets)
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
            }
        }
    }

    /** Lagerort des Sets, entprellt; massgeblich ist der normalisierte Ort aus der Antwort. */
    fun setzeSetLagerort(setNumber: String, ort: String) {
        lagerJob?.cancel()
        lagerJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            when (val r = sets.setSetStorage(setNumber, ort)) {
                is Result.Success -> {
                    if (!r.data.success) { _snackbar.value = r.data.error ?: ""; return@launch }
                    dienste.bestand.melde(Aenderung.Sets)
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    fun deleteSet(setNumber: String) {
        viewModelScope.launch {
            val (geloescht, satz) = setLoeschen(sets, dienste.texte, setNumber)
            _snackbar.value = satz
            if (geloescht) dienste.bestand.melde(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren)
        }
    }

    fun ladeAnleitungHoch(setNumber: String, uri: Uri) {
        viewModelScope.launch {
            val gelesen = leser.lies(uri)
            val typ = gelesen?.first
            if (gelesen == null || typ == null) { _snackbar.value = text(R.string.csv_upload_unreadable); return@launch }
            if (typ !in ANLEITUNG_TYPEN) { _snackbar.value = text(R.string.instr_upload_wrong_type); return@launch }
            val bytes = gelesen.second
            if (bytes.size > ANLEITUNG_MAX_BYTES) {
                _snackbar.value = text(R.string.csv_upload_too_big, ANLEITUNG_MAX_BYTES / 1024 / 1024)
                return@launch
            }
            val name = leser.name(uri) ?: "anleitung"
            when (val r = sets.uploadAnleitung(setNumber, name, typ, bytes, name)) {
                is Result.Success ->
                    if (r.data.success) {
                        _snackbar.value = text(R.string.instr_upload_done)
                        loadSetDetail(setNumber)
                    } else _snackbar.value = r.data.error ?: text(R.string.err_generic)
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    fun loescheAnleitung(setNumber: String, instrId: Int) {
        viewModelScope.launch {
            when (val r = sets.deleteAnleitung(setNumber, instrId)) {
                is Result.Success ->
                    if (r.data.success) loadSetDetail(setNumber)
                    else _snackbar.value = r.data.error ?: text(R.string.err_generic)
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    override fun beiAenderung(aenderung: Aenderung) {
        val betrifftDiesesSet = when (aenderung) {
            Aenderung.Sets -> true
            is Aenderung.SetZusammenfassung -> aenderung.agg.setNumber == setNumber
            Aenderung.Teile, Aenderung.Figuren, Aenderung.Merkliste, Aenderung.Alarme -> false
        }
        if (betrifftDiesesSet && _setDetailState.value.setDetail != null) {
            loadSetDetail(setNumber)
            loadAcquisitions(setNumber)
        }
        if (aenderung == Aenderung.Alarme && setNumber.isNotBlank()) loadPreisalarme(setNumber)
    }

    override fun zuruecksetzen() {
        lagerJob?.cancel()
        _setDetailState.value = SetDetailUiState()
    }

    private companion object {
        const val ARG_SET = "setNumber"
    }
}
