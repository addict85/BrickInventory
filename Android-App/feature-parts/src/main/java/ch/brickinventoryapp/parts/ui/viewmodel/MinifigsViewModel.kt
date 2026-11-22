package ch.brickinventoryapp.parts.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.account.AccountView
import ch.brickinventoryapp.data.local.StockReconciliation
import ch.brickinventoryapp.data.parts.MinifigsRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.FigureOrder
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.ui.ListView
import ch.brickinventoryapp.parts.ui.Figures
import ch.brickinventoryapp.parts.ui.MinifigsLocal
import ch.brickinventoryapp.parts.ui.MinifigsUiState
import ch.brickinventoryapp.parts.ui.PartsSessionUiState
import ch.brickinventoryapp.parts.ui.SetItemFlow
import ch.brickinventoryapp.parts.ui.SetItemUiState
import ch.brickinventoryapp.parts.ui.partsSession
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.viewmodel.DeletionMark
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.Observed
import ch.brickinventoryapp.state.ui.viewmodel.loadPerServer
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The figures tab: list, search, entering and editing manual figures, plus the
 * dialog "which sets is this figure in". Search and view live in the
 * [SavedStateHandle], the account filter does not.
 */
@HiltViewModel
class MinifigsViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val changes: StockReconciliation,
    private val figures: MinifigsRepository,
    private val accountView: AccountView,
    private val wanted: SavedStateHandle,
) : ViewModel(), FilterChoice by filter, FiguresActions, WithSetItem {

    internal val sessionValues: StateFlow<PartsSessionUiState> =
        session.state.map(::partsSession).stateIn(viewModelScope, SharingStarted.Eagerly, partsSession(session.state.value))

    init {
        logoutSequence(session) { reset() }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setAccount(view, value)
            if (view == ScopeFilter.View.MINIFIGS) loadMinifigs()
        }
    }

    private val account get() = filter.accountFor(ScopeFilter.View.MINIFIGS)

    private fun query(st: MinifigsUiState): AccountView.MinifigsQuery? =
        account?.let { AccountView.MinifigsQuery(it, st.minifigsQuery.ifBlank { null }) }

    private val list = Figures(
        scope = viewModelScope,
        reportError = { messages.show(messages.messageForSnackbar(it)) },
        lists = MinifigsLocal(
            figures = { st -> query(st)?.let { accountView.figureList.observe(it) }
                ?: figures.observeMinifigs(st.minifigsQuery) },
            manualMinifigs = { st -> query(st)?.let { accountView.manualMinifigs.observe(it) }
                ?: figures.observeManualMinifigs(st.minifigsQuery) },
            refresh = { st -> refresh(st) },
            metrics = { figures.getMinifigStats(account) },
        ),
    )

    private suspend fun refresh(st: MinifigsUiState): Outcome<Unit> {
        val a = query(st) ?: return figures.refreshMinifigs()
        val r = accountView.figureList.refresh(a)
        return if (r is Outcome.Failure) r else accountView.manualMinifigs.refresh(a)
    }

    /** A manual figure that is only deleted once the snackbar ends without „Rückgängig“. */
    data class ReservedMinifig(val figNumber: String, val owner: Int?, val name: String)

    val delete = DeletionMark<ReservedMinifig>(viewModelScope) { v ->
        val r = figures.deleteMinifig(v.figNumber, v.owner)
        if (r is Outcome.Failure) messages.show(messages.messageForSnackbar(r))
    }

    private val order = MutableStateFlow(wanted[F_ORDER] ?: FigureOrder.DEFAULT)

    private val minifigsObserved = Observed(combine(list.uiState, order, delete.value, ::shown)
        .stateIn(viewModelScope, SharingStarted.Eagerly, shown(list.uiState.value, order.value, delete.value.value)))

    /** The list in the chosen order, without the figure pending deletion. */
    private fun shown(st: MinifigsUiState, o: FigureOrder, v: ReservedMinifig?): MinifigsUiState {
        val sorted = st.copy(minifigs = o.sort(st.minifigs), order = o)
        return if (v == null) sorted else sorted.copy(manualFigs = sorted.manualFigs?.filterNot {
            it.figNumber == v.figNumber && (v.owner == null || it.userId == v.owner) })
    }
    val minifigsState: StateFlow<MinifigsUiState> = minifigsObserved

    private val inSets = SetItemFlow(viewModelScope, ItemKind.FIG,
        query = { number, _ -> figures.getSetsWithMinifig(number, account) },
        afterHeader = filter::loadLocationStock)
    override val setItemState: StateFlow<SetItemUiState> = inSets.uiState

    init {
        viewModelScope.launch { changes.minifigsChanged().collect { list.loadMetrics() } }
        list.placeAgain(wanted[F_SEARCH] ?: "", wanted[F_VIEW] ?: ListView.CARDS)
        // Only fetch an empty list: the store keeps it current itself afterward.
        loadPerServer(session, minifigsObserved) { if (list.uiState.value.minifigs.isEmpty()) loadMinifigs() }
    }

    override fun loadMinifigs(debounce: Boolean) = list.load(debounced = debounce)

    override fun setMinifigsQuery(q: String) { wanted[F_SEARCH] = q; list.setSearch(q) }
    override fun setMinifigsView(value: ListView) { wanted[F_VIEW] = value; list.setView(value) }

    override fun addMinifig(entry: FigureEntry) {
        val e = entry
        viewModelScope.launch {
            when (val r = figures.addMinifig(e.number.trim(), e.blNumber, e.quantity, e.unitPrice,
                                          e.condition, e.owner,
                                          e.storageLocation?.trim()?.takeIf { it.isNotEmpty() })) {
                is Outcome.Success -> messages.show(entryMessage(messages, r.data.created, r.data.number, r.data.priceFromState))
                is Outcome.Failure -> messages.show(messages.messageForSnackbar(r))
            }
        }
    }

    override fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?,
                      condition: Condition?, owner: Int?) =
        applyChangeTo(messages, messages.text(R.string.vm_saved)) {
            figures.updateMinifig(figNumber, quantity, unitPrice, blFigNumber, condition, owner)
        }

    override fun minifigDeleteReserve(figNumber: String, owner: Int?, name: String) =
        delete.reserve(ReservedMinifig(figNumber, owner, name))

    override fun setMinifigsOrder(value: FigureOrder) {
        wanted[F_ORDER] = value
        order.value = value
    }

    override fun deleteMinifig(figNumber: String, owner: Int?) =
        applyChangeTo(messages, messages.text(R.string.vm_minifig_deleted)) {
            figures.deleteMinifig(figNumber, owner)
        }

    override fun openSetItem(number: String, colorId: Int) = inSets.open(number, colorId)

    override fun closeSetItem() = inSets.shutDown()

    override fun setPartLocation(number: String, color: Int, location: String) = Unit

    private fun reset() {
        list.reset()
        inSets.shutDown()
        wanted.remove<String>(F_SEARCH)
        wanted.remove<ListView>(F_VIEW)
        wanted.remove<FigureOrder>(F_ORDER)
        order.value = FigureOrder.DEFAULT
    }

    private companion object {
        const val F_SEARCH = "figuren_suche"
        const val F_VIEW = "figuren_ansicht"
        const val F_ORDER = "figuren_ordnung"
    }
}
