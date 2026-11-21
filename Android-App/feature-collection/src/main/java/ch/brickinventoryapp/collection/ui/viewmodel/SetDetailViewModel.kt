package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.Laden
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.SetKatalogRepository
import ch.brickinventoryapp.model.domain.Zustand
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.collection.ui.Preisalarmeingabe
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import ch.brickinventoryapp.model.domain.SetAnsicht
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.Gelesen
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.state.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut

/**
 * How large an instruction manual may be — the same value as `limits.fileSize` in
 * routes/sets.ts. The app must know the limit before it sends 80 MB over
 * the mobile network.
 */
internal const val INSTRUCTION_MAX_BYTES = 50L * 1024 * 1024

/**
 * The types the server accepts (INSTR_EXT_BY_MIME in routes/sets.ts). It
 * derives the file extension from them; the app already filters the selection.
 */
internal val INSTRUCTION_TYPES = arrayOf("application/pdf", "image/jpeg", "image/png")

/**
 * The detail view of a set: master data, price and history, purchases,
 * price alerts, instructions, quantity and storage location.
 *
 * Which set, lives in the [SavedStateHandle] (navigation argument `setNumber`):
 * after a process death the view opens the same set again.
 */
@HiltViewModel
class SetDetailViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val sets: SetsRepository,
    private val katalog: SetKatalogRepository,
    private val alerts: AlarmRepository,
    private val dateien: SetDateienRepository,
    private val finanzen: FinancesRepository,
    private val haushalt: HouseholdRepository,
    private val reader: FileReader,
    gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, SetDetailAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    /** From the route set_detail/{setNumber}. */
    val setNumber: String = gemerkt[ARG_SET] ?: ""

    private val _setDetailState = MutableStateFlow(SetDetailUiState())
    val setDetailState: StateFlow<SetDetailUiState> = _setDetailState.asStateFlow()

    /**
     * This set, as the gallery shows it from the store: the tile stands there until the
     * detail is loaded. From the same source instead of from the gallery's ViewModel.
     */
    val vorschau: StateFlow<SetAnsicht?> = sets.observeSets()
        .map { l -> l.liste.firstOrNull { it.setNumber == setNumber } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(PREVIEW_HOLD_MS), null)

    // One fetch per section: a new one cancels the running one, so that no late
    // answer from an old fetch overwrites the newer one.
    private val laufend = HashMap<Abschnitt, Job>()

    // After setNumber and the state: an init before that would not yet see either assigned.
    init {
        sequenceSignOut(sitzung) { reset() }
        // If this set changes in the store — here or elsewhere — detail and purchases are no longer valid.
        viewModelScope.launch {
            sets.observeSets().map { l -> l.liste.firstOrNull { it.setNumber == setNumber } }
                .distinctUntilChanged().drop(1).collect {
                    if (_setDetailState.value.setDetail != null) { loadDetail(); loadPurchases() }
                }
        }
    }

    // Quantity, storage location and alert wait out the debounce period; the jobs run in the
    // ViewModel's scope and so survive navigating back.
    private var storageJob: Job? = null
    private val alarmInput = Preisalarmeingabe(
        scope = viewModelScope, alerts = alerts,
        melde = { meldungen.zeige(it) },
        describe = { meldungen.meldungFuerSnackbar(it) },
        gespeichert = { sn -> if (sn == setNumber) loadPriceAlerts() },
    )

    // At the end of the fields: the fetches need laufend and alarmInput already assigned.
    init { refresh() }

    /** Fetch everything the view shows anew; on creation and on „Erneut versuchen“. */
    override fun refresh() {
        loadDetail()
        loadPrice()
        loadHistory()
        loadPurchases()
        loadPriceAlerts()
    }

    private fun starte(section: Abschnitt, abruf: suspend () -> Unit) {
        if (setNumber.isBlank()) return
        laufend.remove(section)?.cancel()
        laufend[section] = viewModelScope.launch { abruf() }
    }

    private fun loadDetail() = starte(Abschnitt.DETAIL) {
        _setDetailState.update { it.copy(detailFetch = Laden.Loads) }
        when (val r = katalog.getSetDetail(setNumber)) {
            is Ergebnis.Erfolg -> {
                _setDetailState.update { it.copy(setDetail = r.data, detailFetch = Laden.Daten(Unit)) }
                // The suggestions for the storage location field belong to the set's owner, not the viewer.
                filter.loadLocationStock(r.data?.owners.orEmpty().map { it.id })
            }
            is Ergebnis.Fehler -> _setDetailState.update { it.copy(detailFetch = loadError(r)) }
        }
    }

    private fun loadPrice() = starte(Abschnitt.PRICE) {
        _setDetailState.update { it.copy(priceFetch = Laden.Loads) }
        when (val r = finanzen.getSetPrice(setNumber)) {
            is Ergebnis.Erfolg -> _setDetailState.update { it.copy(setPrice = r.data, priceFetch = Laden.Daten(Unit)) }
            is Ergebnis.Fehler -> _setDetailState.update { it.copy(priceFetch = loadError(r)) }
        }
    }

    private fun loadHistory() = starte(Abschnitt.HISTORY) {
        _setDetailState.update { it.copy(historyFetch = Laden.Loads) }
        when (val r = finanzen.getSetPriceHistory(setNumber)) {
            is Ergebnis.Erfolg -> _setDetailState.update { it.copy(priceHistory = r.data, historyFetch = Laden.Daten(Unit)) }
            is Ergebnis.Fehler -> _setDetailState.update { it.copy(historyFetch = loadError(r)) }
        }
    }

    private fun loadPurchases() = starte(Abschnitt.PURCHASES) {
        _setDetailState.update { it.copy(purchasesFetch = Laden.Loads) }
        when (val r = haushalt.getAcquisitions(setNumber)) {
            is Ergebnis.Erfolg -> _setDetailState.update {
                it.copy(acquisitions = r.data.kaeufe, acquisitionTotals = r.data.sums,
                        purchasesFetch = Laden.Daten(Unit))
            }
            is Ergebnis.Fehler -> _setDetailState.update { it.copy(purchasesFetch = loadError(r)) }
        }
    }

    private fun loadPriceAlerts() = starte(Abschnitt.ALERTS) {
        alerts.refreshAlerts()
        val liste = alerts.observeAlerts(setNumber).first().liste
        _setDetailState.update { it.copy(preisalarme = liste) }
    }

    override fun setPriceAlert(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand) =
        alarmInput.setze(setNumber, richtung, roh, zustand)

    /**
     * Change the quantity. The new number appears in the view right away; the other
     * stock views follow the store, into which the repository writes it.
     */
    fun setQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Zustand? = null) =
        changeQuantity(setNumber) { sets.setQuantity(setNumber, quantity, purchasePrice, condition) }

    /** The slider: one step, so that simultaneous clicks on two devices add up. */
    override fun changeQuantityUm(setNumber: String, schritt: Int) =
        changeQuantity(setNumber) { sets.changeQuantityUm(setNumber, schritt) }

    private fun changeQuantity(setNumber: String, call: suspend () -> Ergebnis<Int?>) {
        viewModelScope.launch {
            when (val r = call()) {
                is Ergebnis.Erfolg -> {
                    r.data?.let { echt ->
                        _setDetailState.update { st ->
                            if (st.setDetail?.setNumber == setNumber)
                                st.copy(setDetail = st.setDetail.copy(quantity = echt)) else st
                        }
                    }
                }
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /** The set's storage location, debounced; what counts is the normalized location from the response. */
    override fun setSetLocation(setNumber: String, ort: String) {
        storageJob?.cancel()
        storageJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            when (val r = sets.setSetStorage(setNumber, ort)) {
                is Ergebnis.Erfolg -> Unit
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    fun deleteSet(setNumber: String) {
        viewModelScope.launch {
            meldungen.zeige(setLoeschen(sets, meldungen, setNumber).second)
        }
    }

    override fun loadInstructionHigh(setNumber: String, datei: FileRef) {
        viewModelScope.launch {
            val gelesen = reader.readAtMost(datei, INSTRUCTION_MAX_BYTES)
            if (gelesen == Gelesen.ToLarge) {
                meldungen.zeige(meldungen.text(R.string.csv_upload_too_big, INSTRUCTION_MAX_BYTES / 1024 / 1024))
                return@launch
            }
            val typ = (gelesen as? Gelesen.Inhalt)?.typ
            if (gelesen !is Gelesen.Inhalt || typ == null) { meldungen.zeige(meldungen.text(R.string.csv_upload_unreadable)); return@launch }
            if (typ !in INSTRUCTION_TYPES) { meldungen.zeige(meldungen.text(R.string.instr_upload_wrong_type)); return@launch }
            val bytes = gelesen.bytes
            val name = reader.name(datei) ?: "anleitung"
            when (val r = dateien.uploadInstruction(setNumber, name, typ, bytes, name)) {
                is Ergebnis.Erfolg -> {
                    meldungen.zeige(meldungen.text(R.string.instr_upload_done))
                    loadDetail()
                }
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun loescheAnleitung(setNumber: String, instrId: Int) {
        viewModelScope.launch {
            when (val r = dateien.deleteAnleitung(setNumber, instrId)) {
                is Ergebnis.Erfolg -> loadDetail()
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    private fun reset() {
        storageJob?.cancel()
        laufend.values.forEach { it.cancel() }
        laufend.clear()
        _setDetailState.value = SetDetailUiState()
    }

    private enum class Abschnitt { DETAIL, PRICE, HISTORY, PURCHASES, ALERTS }

    private companion object {
        const val ARG_SET = "setNumber"
    }
}

/** The preview stays subscribed this long after the last observer (rotating the device). */
private const val PREVIEW_HOLD_MS = 5_000L
