package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.data.repository.WantedRepository
import ch.brickinventoryapp.model.domain.WantedSort
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.SharingStarted
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.session.derived
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.alarm.AlarmInput
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.CatalogRepository
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.AccountView
import ch.brickinventoryapp.collection.ui.WantedUiState
import ch.brickinventoryapp.collection.ui.WantedItemDetailUiState
import ch.brickinventoryapp.collection.ui.PriceAlarmInput
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.state.ui.errorClass
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.model.ui.Load
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence

/**
 * Wishlist and wishlist-item detail — what one would like to have, separate from ownership.
 *
 * How a wishlist item is created, taken over or filtered is decided by the
 * server (utils/merkliste.ts); here it is only asked for and shown. Search,
 * condition and sorting live in the [SavedStateHandle].
 */
@HiltViewModel
class WantedListViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val wantedList: WantedRepository,
    private val alerts: AlarmRepository,
    private val accountView: AccountView,
    private val catalogRepo: CatalogRepository,
    private val finances: FinancesRepository,
    private val wanted: SavedStateHandle,
) : ViewModel(), FilterChoice by filter, WantedListActions {

    val state: StateFlow<AppUiState> = session.state

    init {
        logoutSequence(session) { reset() }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setAccount(view, value)
            afterFilter(view)
        }
    }

    override fun setStorageFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.applyStorage(view, value)
            afterFilter(view)
        }
    }

    private val _wantedState = MutableStateFlow(WantedUiState(
        query = wanted[SEARCH] ?: "",
        stateFilter = Condition.from(wanted[STATE]),
        sorting = WantedSort.from(wanted[SORTING]),
    ))
    /** A wishlist item that is only deleted once the snackbar ends without „Rückgängig“. */
    data class ReservedWantedItem(val setNumber: String, val condition: Condition, val owner: Int?, val name: String)

    private val _reserved = MutableStateFlow<ReservedWantedItem?>(null)
    val marked: StateFlow<ReservedWantedItem?> = _reserved.asStateFlow()

    /** The source of the list for the configured filters; [loadWanted] chooses it. */
    private val source = MutableStateFlow<Flow<Local<WantedItemView>>>(flowOf(Local(emptyList(), null)))

    @OptIn(ExperimentalCoroutinesApi::class)
    private val list: StateFlow<Local<WantedItemView>?> =
        source.flatMapLatest { it }.stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /**
     * The list shows only the source — the store, or, over selected accounts, the account view —,
     * including what was added or deleted offline, right away. The item pending deletion is missing from it.
     */
    val wantedState: StateFlow<WantedUiState> = _wantedState
        .derived(list) { st, l ->
            if (l?.state != null) st.copy(wantedItem = l.list) else st
        }
        .derived(_reserved) { st, v ->
            if (v == null) st else st.copy(wantedItem = st.wantedItem.filterNot { it.setNumber == v.setNumber && it.condition == v.condition })
        }

    init {
        // Whoever shows the list gets it fresh; the source after that follows the store itself.
        observeLoadOn(_wantedState) { loadWanted() }
    }

    private val _wantedItemDetailState = MutableStateFlow(WantedItemDetailUiState())
    val wantedItemDetailState: StateFlow<WantedItemDetailUiState> = _wantedItemDetailState.asStateFlow()

    // A job of its own for the search: a new keystroke cancels the
    // waiting fetch, and loading only happens after the pause.
    private var suchJob: Job? = null

    private fun accountQuery(f: WantedUiState): AccountView.RememberQuery? =
        filter.accountFor(ScopeFilter.View.WANTED_LIST)?.let {
            AccountView.RememberQuery(it, f.query.trim().ifBlank { null }, f.stateFilter, f.sorting)
        }

    private val alarmInput = PriceAlarmInput(
        scope = viewModelScope, alerts = alerts,
        report = { messages.show(it) },
        describe = { messages.messageForSnackbar(it) },
        saved = { sn -> if (_wantedItemDetailState.value.setNumber == sn) loadPriceAlarms(sn) },
    )

    override fun loadWanted() {
        viewModelScope.launch {
            val f = _wantedState.value
            _wantedState.update { it.copy(fetch = Load.Loads) }
            val account = accountQuery(f)
            source.value = account?.let { accountView.wantedList.observe(it) }
                ?: wantedList.observeWanted(f.query.trim().ifBlank { null }, f.stateFilter, f.sorting)
            // The fetch only fills the source; it is shown by wantedState.
            val r = account?.let { accountView.wantedList.refresh(it) } ?: wantedList.refreshWanted()
            when (r) {
                is Outcome.Success -> _wantedState.update { it.copy(fetch = Load.Data(Unit, r.state)) }
                is Outcome.Failure -> {
                    _wantedState.update { it.copy(fetch = Load.Failure(errorClass(r), errorMessage(r))) }
                    messages.show(messages.messageForSnackbar(r)?.let { messages.text(R.string.vm_error, it) })
                }
            }
        }
    }

    override fun setWantedSearch(q: String) {
        wanted[SEARCH] = q
        _wantedState.update { it.copy(query = q) }
        suchJob?.cancel()
        suchJob = viewModelScope.launch {
            delay(SEARCH_PAUSE_MS)
            loadWanted()
        }
    }

    override fun setWantedState(condition: Condition?) {
        wanted[STATE] = condition?.identifier
        _wantedState.update { it.copy(stateFilter = condition) }
        loadWanted()
    }

    override fun setWantedSorting(sorting: WantedSort) {
        wanted[SORTING] = sorting.identifier
        _wantedState.update { it.copy(sorting = sorting) }
        loadWanted()
    }

    override fun createWantedItem(setNumber: String, condition: Condition, owner: Int?) {
        val number = setNumber.trim()
        if (number.isBlank()) { messages.show(messages.text(R.string.wanted_need_number)); return }
        viewModelScope.launch {
            messages.show(createWantedItem(wantedList, messages, number, condition, owner))
        }
    }

    override fun moveWantedItem(setNumber: String, condition: Condition, ofId: Int, toId: Int) {
        if (ofId == toId) return
        viewModelScope.launch {
            when (val r = wantedList.moveWantedItem(setNumber, condition, ofId, toId)) {
                is Outcome.Success -> {
                    messages.show(messages.text(
                        if (r.data) R.string.wanted_already else R.string.vm_saved))
                }
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r)?.let { messages.text(R.string.vm_error, it) })
            }
        }
    }

    /**
     * Delete with „Rückgängig“ as in the gallery: the item disappears right away, the
     * server learns of it only with [executeWantedItemDelete]. With it, threshold,
     * direction and "on the list since" would be lost. An earlier pending deletion is deleted first.
     */
    override fun deleteWantedItem(setNumber: String, condition: Condition, owner: Int?) {
        executeWantedItemDelete()
        // The shown list, not the raw one: without filters the item is only in the store.
        val name = wantedState.value.wantedItem
            .firstOrNull { it.setNumber == setNumber && it.condition == condition }?.name ?: setNumber
        _reserved.value = ReservedWantedItem(setNumber, condition, owner, name)
    }

    /** The item pending deletion remains; it was in the source the whole time. */
    fun wantedItemUndo(only: ReservedWantedItem? = null) {
        if (_reserved.value == null || (only != null && _reserved.value != only)) return
        _reserved.value = null
    }

    /** [only]: only this item — a superseded snackbar does not carry out the next one. */
    fun executeWantedItemDelete(only: ReservedWantedItem? = null) {
        val v = _reserved.value ?: return
        if (only != null && v != only) return
        _reserved.value = null
        viewModelScope.launch {
            when (val r = wantedList.deleteWantedItem(v.setNumber, v.condition, v.owner)) {
                // „genommen“ was already in the snackbar with „Rückgängig“; the store no longer has it.
                is Outcome.Success -> Unit
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r)?.let { messages.text(R.string.vm_error, it) })
            }
        }
    }

    /** The wishlist item becomes a possession; the server decides what happens to the entry and the alert. */
    override fun adoptWantedItem(
        setNumber: String, condition: Condition, owner: Int?,
        count: Int, purchasePriceRaw: String, recordedAs: Condition?,
        storageLocation: String?,
    ) {
        viewModelScope.launch {
            val price = AlarmInput.number(purchasePriceRaw)
            when (val r = wantedList.adoptWantedItem(setNumber, condition, count, price,
                                                   recordedAs, owner,
                                                   storageLocation?.trim()?.takeIf { it.isNotEmpty() })) {
                is Outcome.Success -> {
                    messages.show(messages.text(
                        if (r.data) R.string.wanted_taken_existing
                        else R.string.wanted_taken))
                }
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r)?.let { messages.text(R.string.vm_error, it) })
            }
        }
    }

    /** Catalog data, prices and history of a wishlist item — each on its own; whatever is missing stays empty. */
    override fun wantedItemDetailOf(setNumber: String): StateFlow<WantedItemDetailUiState> =
        Observed(wantedItemDetailState) { loadWantedItemDetail(setNumber) }

    override fun loadWantedItemDetail(setNumber: String) {
        viewModelScope.launch {
            _wantedItemDetailState.value = WantedItemDetailUiState(setNumber = setNumber, fetch = Load.Loads)
            if (wantedState.value.wantedItem.isEmpty()) loadWanted()
            loadPriceAlarms(setNumber)
            val catalog = (catalogRepo.getCatalogSetDetail(setNumber) as? Outcome.Success)?.data
            _wantedItemDetailState.update { it.copy(catalog = catalog) }
            val prices = (wantedList.getWantedItemPrices(setNumber) as? Outcome.Success)?.data
            _wantedItemDetailState.update { it.copy(prices = prices) }
            val history = (finances.getSetPriceHistory(setNumber) as? Outcome.Success)?.data
            _wantedItemDetailState.update { it.copy(history = history, fetch = Load.Data(Unit)) }
        }
    }

    fun loadPriceAlarms(setNumber: String) {
        viewModelScope.launch {
            alerts.refreshAlerts()
            val list = alerts.observeAlerts(setNumber).first().list
            _wantedItemDetailState.update { if (it.setNumber == setNumber) it.copy(priceAlarms = list) else it }
        }
    }

    override fun setPriceAlert(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition) =
        alarmInput.set(setNumber, direction, raw, condition)

    private fun afterFilter(view: ScopeFilter.View) {
        if (view == ScopeFilter.View.WANTED_LIST) loadWanted()
    }

    private fun reset() {
        suchJob?.cancel()
        source.value = flowOf(Local(emptyList(), null))
        _wantedState.value = WantedUiState()
        _wantedItemDetailState.value = WantedItemDetailUiState()
    }

    private companion object {
        const val SEARCH = "merkliste_suche"
        const val STATE = "merkliste_zustand"
        const val SORTING = "merkliste_sortierung"
        const val SEARCH_PAUSE_MS = 350L
    }
}

/**
 * Create a wishlist item and report what became of it. Shared with
 * capture: a scan out of the wishlist also creates one.
 */
internal suspend fun createWantedItem(
    wantedList: WantedRepository, texts: Texts, setNumber: String, condition: Condition, owner: Int?,
): String? = when (val r = wantedList.createWantedItem(setNumber, condition, owner)) {
    is Outcome.Success -> texts.text(if (r.data) R.string.wanted_added else R.string.wanted_already)
    is Outcome.Failure -> texts.messageForSnackbar(r)?.let { texts.text(R.string.vm_error, it) }
}
