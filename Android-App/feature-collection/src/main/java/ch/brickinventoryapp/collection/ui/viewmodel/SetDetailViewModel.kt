package ch.brickinventoryapp.collection.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.collection.ui.PriceAlarmInput
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import ch.brickinventoryapp.data.account.HouseholdRepository
import ch.brickinventoryapp.data.alarm.AlarmInput
import ch.brickinventoryapp.data.catalog.SetCatalogRepository
import ch.brickinventoryapp.data.collection.AlarmRepository
import ch.brickinventoryapp.data.collection.SetFilesRepository
import ch.brickinventoryapp.data.collection.SetsRepository
import ch.brickinventoryapp.data.finances.FinancesRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.file.Read
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

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
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val sets: SetsRepository,
    private val catalog: SetCatalogRepository,
    private val alerts: AlarmRepository,
    private val files: SetFilesRepository,
    private val finances: FinancesRepository,
    private val household: HouseholdRepository,
    private val reader: FileReader,
    wanted: SavedStateHandle,
) : ViewModel(), FilterChoice by filter, SetDetailActions {

    val state: StateFlow<AppUiState> = session.state

    /** From the route set_detail/{setNumber}. */
    val setNumber: String = wanted[ARG_SET] ?: ""

    private val _setDetailState = MutableStateFlow(SetDetailUiState())
    val setDetailState: StateFlow<SetDetailUiState> = _setDetailState.asStateFlow()

    /**
     * This set, as the gallery shows it from the store: the tile stands there until the
     * detail is loaded. From the same source instead of from the gallery's ViewModel.
     */
    val preview: StateFlow<SetView?> = sets.observeSets()
        .map { l -> l.list.firstOrNull { it.setNumber == setNumber } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(PREVIEW_HOLD_MS), null)

    // One fetch per section: a new one cancels the running one, so that no late
    // answer from an old fetch overwrites the newer one.
    private val running = HashMap<Section, Job>()

    // After setNumber and the state: an init before that would not yet see either assigned.
    init {
        logoutSequence(session) { reset() }
        // If this set changes in the store — here or elsewhere — detail and purchases are no longer valid.
        viewModelScope.launch {
            sets.observeSets().map { l -> l.list.firstOrNull { it.setNumber == setNumber } }
                .distinctUntilChanged().drop(1).collect {
                    if (_setDetailState.value.setDetail != null) { loadDetail(); loadPurchases() }
                }
        }
    }

    // Quantity, storage location and alert wait out the debounce period; the jobs run in the
    // ViewModel's scope and so survive navigating back.
    private var storageJob: Job? = null
    private val alarmInput = PriceAlarmInput(
        scope = viewModelScope, alerts = alerts,
        report = { messages.show(it) },
        describe = { messages.messageForSnackbar(it) },
        saved = { sn -> if (sn == setNumber) loadPriceAlerts() },
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

    private fun launch(section: Section, fetch: suspend () -> Unit) {
        if (setNumber.isBlank()) return
        running.remove(section)?.cancel()
        running[section] = viewModelScope.launch { fetch() }
    }

    private fun loadDetail() = launch(Section.DETAIL) {
        _setDetailState.update { it.copy(detailFetch = Load.Loads) }
        when (val r = catalog.getSetDetail(setNumber)) {
            is Outcome.Success -> {
                _setDetailState.update { it.copy(setDetail = r.data, detailFetch = Load.Data(Unit)) }
                // The suggestions for the storage location field belong to the set's owner, not the viewer.
                filter.loadLocationStock(r.data?.owners.orEmpty().map { it.id })
            }
            is Outcome.Failure -> _setDetailState.update { it.copy(detailFetch = loadError(r)) }
        }
    }

    private fun loadPrice() = launch(Section.PRICE) {
        _setDetailState.update { it.copy(priceFetch = Load.Loads) }
        when (val r = finances.getSetPrice(setNumber)) {
            is Outcome.Success -> _setDetailState.update { it.copy(setPrice = r.data, priceFetch = Load.Data(Unit)) }
            is Outcome.Failure -> _setDetailState.update { it.copy(priceFetch = loadError(r)) }
        }
    }

    private fun loadHistory() = launch(Section.HISTORY) {
        _setDetailState.update { it.copy(historyFetch = Load.Loads) }
        when (val r = finances.getSetPriceHistory(setNumber)) {
            is Outcome.Success -> _setDetailState.update { it.copy(priceHistory = r.data, historyFetch = Load.Data(Unit)) }
            is Outcome.Failure -> _setDetailState.update { it.copy(historyFetch = loadError(r)) }
        }
    }

    private fun loadPurchases() = launch(Section.PURCHASES) {
        _setDetailState.update { it.copy(purchasesFetch = Load.Loads) }
        when (val r = household.getAcquisitions(setNumber)) {
            is Outcome.Success -> _setDetailState.update {
                it.copy(acquisitions = r.data.purchases, acquisitionTotals = r.data.sums,
                        purchasesFetch = Load.Data(Unit))
            }
            is Outcome.Failure -> _setDetailState.update { it.copy(purchasesFetch = loadError(r)) }
        }
    }

    private fun loadPriceAlerts() = launch(Section.ALERTS) {
        alerts.refreshAlerts()
        val list = alerts.observeAlerts(setNumber).first().list
        _setDetailState.update { it.copy(priceAlarms = list) }
    }

    override fun setPriceAlert(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition) =
        alarmInput.set(setNumber, direction, raw, condition)

    /**
     * Change the quantity. The new number appears in the view right away; the other
     * stock views follow the store, into which the repository writes it.
     */
    fun setQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Condition? = null) =
        changeQuantity(setNumber) { sets.setQuantity(setNumber, quantity, purchasePrice, condition) }

    /** The slider: one step, so that simultaneous clicks on two devices add up. */
    override fun changeQuantityBy(setNumber: String, step: Int) =
        changeQuantity(setNumber) { sets.changeQuantityBy(setNumber, step) }

    private fun changeQuantity(setNumber: String, call: suspend () -> Outcome<Int?>) {
        viewModelScope.launch {
            when (val r = call()) {
                is Outcome.Success -> {
                    r.data?.let { real ->
                        _setDetailState.update { st ->
                            if (st.setDetail?.setNumber == setNumber)
                                st.copy(setDetail = st.setDetail.copy(quantity = real)) else st
                        }
                    }
                }
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r)?.let { messages.text(R.string.vm_error, it) })
            }
        }
    }

    /** The set's storage location, debounced; what counts is the normalized location from the response. */
    override fun setSetLocation(setNumber: String, location: String) {
        storageJob?.cancel()
        storageJob = viewModelScope.launch {
            delay(AlarmInput.QUIET_MS)
            when (val r = sets.setSetStorage(setNumber, location)) {
                is Outcome.Success -> Unit
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
        }
    }

    fun deleteSet(setNumber: String) {
        viewModelScope.launch {
            messages.show(setDelete(sets, messages, setNumber).second)
        }
    }

    override fun loadInstructionHigh(setNumber: String, file: FileRef) {
        viewModelScope.launch {
            val read = reader.readAtMost(file, INSTRUCTION_MAX_BYTES)
            if (read == Read.ToLarge) {
                messages.show(messages.text(R.string.csv_upload_too_big, INSTRUCTION_MAX_BYTES / 1024 / 1024))
                return@launch
            }
            val type = (read as? Read.Content)?.type
            if (read !is Read.Content || type == null) { messages.show(messages.text(R.string.csv_upload_unreadable)); return@launch }
            if (type !in INSTRUCTION_TYPES) { messages.show(messages.text(R.string.instr_upload_wrong_type)); return@launch }
            val bytes = read.bytes
            val name = reader.name(file) ?: "anleitung"
            when (val r = files.uploadInstruction(setNumber, name, type, bytes, name)) {
                is Outcome.Success -> {
                    messages.show(messages.text(R.string.instr_upload_done))
                    loadDetail()
                }
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
        }
    }

    override fun deleteInstruction(setNumber: String, instrId: Int) {
        viewModelScope.launch {
            when (val r = files.deleteInstructionNow(setNumber, instrId)) {
                is Outcome.Success -> loadDetail()
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
        }
    }

    private fun reset() {
        storageJob?.cancel()
        running.values.forEach { it.cancel() }
        running.clear()
        _setDetailState.value = SetDetailUiState()
    }

    private enum class Section { DETAIL, PRICE, HISTORY, PURCHASES, ALERTS }

    private companion object {
        const val ARG_SET = "setNumber"
    }
}

/** The preview stays subscribed this long after the last observer (rotating the device). */
private const val PREVIEW_HOLD_MS = 5_000L
