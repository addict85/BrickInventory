package ch.brickinventoryapp.parts.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.alarm.AlarmInput
import ch.brickinventoryapp.data.repository.AccountView
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.StockReconciliation
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.parts.ui.Parts
import ch.brickinventoryapp.parts.ui.PartsFilter
import ch.brickinventoryapp.parts.ui.PartsLocal
import ch.brickinventoryapp.parts.ui.PartsSessionUiState
import ch.brickinventoryapp.parts.ui.PartsSource
import ch.brickinventoryapp.parts.ui.PartsUiState
import ch.brickinventoryapp.parts.ui.SetItemFlow
import ch.brickinventoryapp.parts.ui.SetItemUiState
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.derived
import ch.brickinventoryapp.state.ui.viewmodel.DeletionMark
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The parts tab: list, filter, entering and editing manual parts, plus the dialog
 * "which sets is this part in". The figures have their own [MinifigsViewModel].
 *
 * The [PartsFilter] lives in the [SavedStateHandle] and survives a process death; account and
 * storage location do not, they apply only in memory (the view).
 */
@HiltViewModel
class PartsViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val changes: StockReconciliation,
    private val scrollMemory: ScrollMemory,
    private val repo: PartsRepository,
    private val accountView: AccountView,
    private val wanted: SavedStateHandle,
) : ViewModel(), FilterChoice by filter, PartsActions, WithSetItem {

    internal val state: StateFlow<PartsSessionUiState> =
        session.state.derived { PartsSessionUiState(it.serverUrl, it.currency, it.userDefaultCondition) }

    init {
        logoutSequence(session) { reset() }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setAccount(view, value)
            if (view == ScopeFilter.View.PARTS) loadParts()
        }
    }

    override fun setStorageFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.applyStorage(view, value)
            if (view == ScopeFilter.View.PARTS) loadParts()
        }
    }

    private val partsAccount get() = filter.accountFor(ScopeFilter.View.PARTS)
    private val partsStorage get() = filter.storageFor(ScopeFilter.View.PARTS)?.ifBlank { null }

    /**
     * Account and storage location split the quantities, "In Sets" counts the table: only
     * the server computes that (account view). Otherwise the store applies.
     */
    private fun partsQuery(st: PartsUiState): AccountView.PartsQuery? {
        val f = st.filter
        return if (partsAccount == null && partsStorage == null && f.view != ListView.TABLE) null
        else AccountView.PartsQuery(partsAccount, f.search.ifBlank { null }, f.color,
            f.category, f.spare, f.view == ListView.TABLE, partsStorage)
    }

    private fun manualQuery(st: PartsUiState): AccountView.ManualQuery? =
        if (partsAccount == null && partsStorage == null) null
        else AccountView.ManualQuery(partsAccount, st.filter.search.ifBlank { null }, partsStorage)

    private val parts = Parts(
        scope = viewModelScope,
        source = object : PartsSource {
            override suspend fun partsMetrics() = repo.getPartsStats(partsAccount)
            override suspend fun filterColors() = repo.getPartsFilterColors(partsAccount)
            override suspend fun categories() = repo.getPartsCategories(partsAccount)
            override suspend fun allColors() = repo.getBrickColors()
        },
        reportError = { messages.show(messages.messageForSnackbar(it)) },
        forgetScroll = { scrollMemory.forgetNow("parts") },
        lists = PartsLocal(
            parts = { st -> partsQuery(st)?.let { accountView.partList.observe(it) }
                ?: st.filter.let { f -> repo.observeParts(f.search, f.color, f.category, f.spare) } },
            manualParts = { st -> manualQuery(st)?.let { accountView.manualParts.observe(it) }
                ?: repo.observeManualParts(st.filter.search) },
            refresh = { st -> refreshParts(st) },
        ),
        filterChanged = { wanted[F_FILTER] = it },
    )

    /** Fill every source the state shows; the table alone leaves the manual ones in the store. */
    private suspend fun refreshParts(st: PartsUiState): Outcome<Unit> {
        val list = partsQuery(st) ?: return repo.refreshParts()
        val r = accountView.partList.refresh(list)
        if (r is Outcome.Failure) return r
        return manualQuery(st)?.let { accountView.manualParts.refresh(it) } ?: repo.refreshManualParts()
    }

    /** A manual part that is only deleted once the snackbar ends without „Rückgängig“. */
    data class ReservedPart(val partNumber: String, val colorId: Int, val owner: Int?, val name: String)

    val delete = DeletionMark<ReservedPart>(viewModelScope) { v ->
        val r = repo.deletePart(v.partNumber, v.colorId, v.owner)
        if (r is Outcome.Failure) messages.show(messages.messageForSnackbar(r))
    }

    private val partsObserved = Observed(parts.state.derived(delete.value) { st, v ->
        if (v == null) st else st.copy(manualParts = st.manualParts?.filterNot {
            it.partNumber == v.partNumber && it.colorId == v.colorId && (v.owner == null || it.userId == v.owner) })
    })
    val partsState: StateFlow<PartsUiState> = partsObserved

    private val inSets = SetItemFlow(viewModelScope, ItemKind.PART,
        query = { number, color -> repo.getSetsWithPart(number, color, partsAccount) },
        afterHeader = filter::loadLocationStock)
    override val setItemState: StateFlow<SetItemUiState> = inSets.uiState

    // Debounced like the price alert: whoever types "Kiste 3" should not leave five half
    // locations in the supply, and the job survives navigating back.
    private var storageJob: Job? = null

    init {
        // The list follows the store itself; the server computes the key figures from it.
        viewModelScope.launch { changes.partsChanged().collect { parts.loadMetrics() } }
        wanted.get<PartsFilter>(F_FILTER)?.let(parts::placeFilterAgain)
        // Whoever shows the tab or a single item gets the list, color catalog and filter lists;
        // the two filter lists come from two addresses (PartsApi.getPartsFilterColors).
        loadPerServer(session, partsObserved) { loadParts(); loadPartsColors(); loadPartsFilters() }
    }

    // ── List and filter ─────────────────────────────────────────────────────

    override fun loadParts(page: Int, debounce: Boolean) = parts.load(page = page, debounced = debounce)
    fun loadPartsFilters() = parts.loadFilter()
    override fun loadPartsColors() = parts.loadColors()

    private fun filter(change: (PartsFilter) -> PartsFilter) = parts.setFilter(change(parts.state.value.filter))
    override fun setPartsQuery(q: String) = filter { it.copy(search = q) }
    override fun setPartsSpare(value: SparePartChoice) = filter { it.copy(spare = value) }
    override fun setPartsView(value: ListView) = filter { it.copy(view = value) }
    override fun setPartsOrder(value: PartsFilter.Order) = filter { it.copy(order = value) }
    override fun setPartsColorFilter(value: ColorPicker) = filter { it.copy(color = value) }
    override fun setPartsCategoryFilter(value: CategoryChoice) = filter { it.copy(category = value) }

    // ── Entering and editing ──────────────────────────────────────────────────

    override fun addPart(entry: PartEntry) {
        val e = entry
        viewModelScope.launch {
            when (val r = repo.addPart(e.number.trim(), e.colorId, e.colorName, e.colorHex, e.quantity,
                                       e.unitPrice, e.condition, e.owner,
                                       e.storageLocation?.trim()?.takeIf { it.isNotEmpty() })) {
                is Outcome.Success -> messages.show(entryMessage(messages, r.data.created, r.data.number, r.data.priceFromState))
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
        }
    }

    override fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: Condition?, owner: Int?) =
        applyChangeTo(messages, messages.text(R.string.vm_saved)) {
            repo.updatePart(partNumber, colorId, quantity, unitPrice, condition, owner)
        }

    override fun partDeleteReserve(partNumber: String, colorId: Int, owner: Int?, name: String) =
        delete.reserve(ReservedPart(partNumber, colorId, owner, name))

    override fun deletePart(partNumber: String, colorId: Int, owner: Int?) =
        applyChangeTo(messages, messages.text(R.string.vm_part_deleted)) {
            repo.deletePart(partNumber, colorId, owner)
        }

    /**
     * Change a manual part's color. The color is part of the key
     * and the detail view's route — [onDone] opens it with the new one.
     */
    override fun setPartColor(partNumber: String, colorId: Int, newColor: Int,
                       colorName: String?, colorHex: String?,
                       owner: Int?, onDone: (Int) -> Unit) {
        if (newColor == colorId) return
        applyChangeTo(messages, messages.text(R.string.vm_saved), after = { onDone(newColor) }) {
            repo.setPartColor(partNumber, colorId, newColor, colorName, colorHex, owner)
        }
    }

    // ── "Which sets is this in?" ────────────────────────────────────────

    override fun openSetItem(number: String, colorId: Int) = inSets.open(number, colorId)

    override fun closeSetItem() = inSets.shutDown()

    override fun setPartLocation(number: String, color: Int, location: String) {
        storageJob?.cancel()
        storageJob = viewModelScope.launch {
            delay(AlarmInput.QUIET_MS)
            when (val r = repo.setPartStorage(number, color, location)) {
                is Outcome.Success -> inSets.withLocation(r.data)
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
        }
    }

    private fun reset() {
        storageJob?.cancel()
        parts.reset()
        inSets.shutDown()
        wanted.remove<PartsFilter>(F_FILTER)
    }

    private companion object {
        const val F_FILTER = "teile_filter"
    }
}
