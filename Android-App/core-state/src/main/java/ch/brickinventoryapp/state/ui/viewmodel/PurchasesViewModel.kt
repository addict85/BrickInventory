package ch.brickinventoryapp.state.ui.viewmodel

import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.domain.asMoney
import java.time.LocalDate
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.Condition
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.alarm.AlarmInput
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.domain.PurchaseCorrection
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.StockReconciliation
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.state.ui.ManualItemDetailUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.resources.R
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session

/**
 * The purchases of an entry — set, manual part or manual figure:
 * purchase prices, quantities, dates, owners, plus price history and storage location of
 * manual entries. Serves the detail view of manual entries and the
 * management of purchases.
 */
@HiltViewModel
class PurchasesViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val changes: StockReconciliation,
    private val household: HouseholdRepository,
    private val sets: SetsRepository,
    private val finances: FinancesRepository,
    private val parts: PartsRepository,
    private val figures: MinifigsRepository,
) : ViewModel(), FilterChoice by filter, PurchasesActions {

    val state: StateFlow<AppUiState> = session.state

    init {
        logoutSequence(session) { reset() }
        // If the inventory changes in the store, the entry's purchases and totals may no longer be correct.
        viewModelScope.launch { changes.inventoryChanged().collect { loadNew() } }
    }

    private val _manDetailState = MutableStateFlow(ManualItemDetailUiState())
    val manDetailState: StateFlow<ManualItemDetailUiState> = _manDetailState.asStateFlow()

    /** An entry's purchases, as its page reads them: whoever shows them loads them. */
    fun purchasesOf(type: ItemKind, id: String, colorId: Int): StateFlow<ManualItemDetailUiState> =
        Observed(manDetailState) {
            if (type == ItemKind.SET) loadAcquisitions(id) else loadManualAcquisitions(type, id, colorId)
        }

    private var storageJob: Job? = null

    // ── Laden ────────────────────────────────────────────────────────────────

    override fun loadAcquisitions(setNumber: String) = load(ItemKind.SET, setNumber, NO_COLOR)

    /** Purchases and price history of a manual part or figure. */
    override fun loadManualAcquisitions(type: ItemKind, id: String, colorId: Int) {
        load(type, id, colorId)
        loadManualPriceHistory(type, id, colorId)
    }

    private fun load(type: ItemKind, id: String, colorId: Int) {
        viewModelScope.launch {
            _manDetailState.update {
                // Another entry's history must not stay on screen.
                val equal = it.itemId == id && it.colorId == colorId && it.itemType == type
                it.copy(purchasesFetch = Load.Loads, itemType = type, itemId = id, colorId = colorId,
                        priceHistory = if (equal) it.priceHistory else null)
            }
            val r = when (type) {
                ItemKind.SET -> household.getAcquisitions(id)
                ItemKind.FIG -> household.getFigAcquisitions(id)
                else  -> household.getPartAcquisitions(id, colorId)
            }
            when (r) {
                is Outcome.Success -> _manDetailState.update {
                    it.copy(acquisitions = r.data.purchases, acquisitionTotals = r.data.sums, purchasesFetch = Load.Data(Unit))
                }
                is Outcome.Failure -> _manDetailState.update { it.copy(purchasesFetch = loadError(r)) }
            }
        }
    }

    fun loadManualPriceHistory(type: ItemKind, id: String, colorId: Int = NO_COLOR) {
        viewModelScope.launch {
            _manDetailState.update { it.copy(historyFetch = Load.Loads) }
            val r = if (type == ItemKind.FIG) finances.getFigPriceHistory(id) else finances.getPartPriceHistory(id, colorId)
            when (r) {
                is Outcome.Success -> _manDetailState.update { it.copy(priceHistory = r.data, historyFetch = Load.Data(Unit)) }
                is Outcome.Failure -> _manDetailState.update { it.copy(historyFetch = loadError(r)) }
            }
        }
    }

    private fun loadNew() {
        val st = _manDetailState.value
        val kind = st.itemType ?: return
        if (st.itemId.isBlank()) return
        load(kind, st.itemId, st.colorId)
    }

    // ── Changing ───────────────────────────────────────────────────────────────

    override fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double?, condition: Condition?,
                          quantity: Int?, date: String?) {
        viewModelScope.launch {
            when (val r = household.updateAcquisition(setNumber, acqId, purchasePrice, condition, quantity, date)) {
                is Outcome.Success -> setChanged(r.data.summary)
                is Outcome.Failure -> {
                    messages.show(messages.messageForSnackbar(r))
                    // A rejected date change would otherwise stay in the field.
                    if (date != null) loadAcquisitions(setNumber)
                }
            }
        }
    }

    override fun deleteAcquisition(setNumber: String, acqId: Int) {
        viewModelScope.launch { deleteSetPurchase(setNumber, acqId) }
    }

    private suspend fun deleteSetPurchase(setNumber: String, acqId: Int) {
        when (val r = household.deleteAcquisition(setNumber, acqId)) {
            is Outcome.Success -> setChanged(r.data.summary)
            is Outcome.Failure -> messages.show(messages.messageForSnackbar(r)?.let { messages.text(R.string.vm_error, it) })
        }
    }

    /** A purchase that is only deleted once the snackbar ends without „undo“. */
    data class ReservedPurchase(val type: ItemKind, val id: String, val colorId: Int, val purchaseId: Int)

    val purchaseRoute = DeletionMark<ReservedPurchase>(viewModelScope) { v ->
        if (v.type == ItemKind.SET) deleteSetPurchase(v.id, v.purchaseId) else deleteManualPurchase(v.type, v.id, v.colorId, v.purchaseId)
    }

    override fun purchaseDeleteReserve(type: ItemKind, id: String, colorId: Int, acqId: Int) =
        purchaseRoute.reserve(ReservedPurchase(type, id, colorId, acqId))

    /** If the store has already taken over the set's new total, the tile follows; otherwise the state is fetched. */
    private suspend fun setChanged(adopted: Boolean) {
        if (!adopted) { loadNew(); sets.refreshSets() }
    }

    /** For manual entries the server sends no summary; the store fetches the state. */
    private suspend fun manualNew(type: ItemKind) {
        if (type == ItemKind.FIG) figures.refreshMinifigs() else parts.refreshParts()
    }

    override fun updateManualAcquisition(
        type: ItemKind, id: String, colorId: Int, acqId: Int,
        unitPrice: Double?, condition: Condition?, quantity: Int?, date: String?,
    ) {
        viewModelScope.launch {
            val tag = date?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
            val req = PurchaseCorrection(price = unitPrice.asMoney(), condition = condition, quantity = quantity, datum = tag)
            val r = if (type == ItemKind.FIG) household.updateFigAcquisition(id, acqId, req)
                    else household.updatePartAcquisition(id, colorId, acqId, req)
            if (r is Outcome.Success) {
                manualNew(type)
            } else if (r is Outcome.Failure) {
                messages.show(messages.messageForSnackbar(r))
                if (date != null) loadNew()
            }
        }
    }

    override fun deleteManualAcquisition(type: ItemKind, id: String, colorId: Int, acqId: Int) {
        viewModelScope.launch { deleteManualPurchase(type, id, colorId, acqId) }
    }

    private suspend fun deleteManualPurchase(type: ItemKind, id: String, colorId: Int, acqId: Int) {
        val r = if (type == ItemKind.FIG) household.deleteFigAcquisition(id, acqId)
                else household.deletePartAcquisition(id, colorId, acqId)
        when (r) {
            is Outcome.Success -> manualNew(type)
            is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
        }
    }

    /**
     * Change the owner of ONE purchase-price row — the only way to move
     * inventory between accounts. [onDone] gets an error or null and
     * the parts and figures reported by the server as moved along.
     */
    override fun changeAcquisitionOwner(
        type: ItemKind, id: String, colorId: Int, acqId: Int,
        toUserId: Int, onDone: (String?, Int, Int) -> Unit,
    ) {
        viewModelScope.launch {
            val req = PurchaseCorrection(owner = toUserId)
            val r = when (type) {
                ItemKind.SET -> household.updateAcquisition(id, acqId, ownerUserId = toUserId)
                ItemKind.FIG -> household.updateFigAcquisition(id, acqId, req)
                else  -> household.updatePartAcquisition(id, colorId, acqId, req)
            }
            when (r) {
                is Outcome.Success -> {
                    onDone(null, r.data.parts, r.data.figures)
                    // Parts and figures moved along: only the server knows the state of all three lists.
                    sets.refreshSets(); parts.refreshParts(); figures.refreshMinifigs()
                }
                is Outcome.Failure -> onDone(messages.message(r), 0, 0)
            }
        }
    }

    /** Storage location of a manual entry, debounced like for the set. */
    override fun setManualLocation(type: ItemKind, id: String, color: Int, location: String) {
        storageJob?.cancel()
        storageJob = viewModelScope.launch {
            delay(AlarmInput.QUIET_MS)
            val r = if (type == ItemKind.FIG) figures.setFigStorage(id, location) else parts.setPartStorage(id, color, location)
            when (r) {
                is Outcome.Success -> filter.ownLocationsNew()
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
        }
    }

    private fun reset() {
        storageJob?.cancel()
        _manDetailState.value = ManualItemDetailUiState()
    }
}
