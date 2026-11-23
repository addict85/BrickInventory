package ch.brickinventoryapp.finances.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.finances.FinancesRepository
import ch.brickinventoryapp.data.local.StockReconciliation
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.finances.ui.FinanceUiState
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.FilterChoice
import ch.brickinventoryapp.state.ui.viewmodel.Messages
import ch.brickinventoryapp.state.ui.viewmodel.logoutSequence
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The finance tab: valuation of sets, parts and figures, profit and
 * loss, portfolio history.
 *
 * Chosen row kinds and period live in the [SavedStateHandle]: they are a
 * decision of the user and should survive a process death, while the
 * loaded numbers come fresh again on the next open anyway.
 */
@HiltViewModel
class FinanceViewModel @Inject constructor(
    private val session: Session,
    private val filter: FilterChoice,
    private val messages: Messages,
    private val changes: StockReconciliation,
    private val finances: FinancesRepository,
    private val wanted: SavedStateHandle,
) : ViewModel(), FilterChoice by filter, FinanceActions {

    val state: StateFlow<AppUiState> = session.state

    init {
        logoutSequence(session) { reset() }
        // The valuation is computed by the server from the store's stock; if that changes, it is no longer valid.
        viewModelScope.launch { changes.inventoryChanged().collect { loadValuation() } }
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

    private val _financeState = MutableStateFlow(rememberedState())
    val financeState: StateFlow<FinanceUiState> = _financeState.asStateFlow()

    init {
        // Whoever opens finances loads what is missing; returning does not load anything twice.
        observeLoadOn(_financeState) {
            val s = _financeState.value
            if (s.valuation == null && !s.valuationLoad.loading) loadValuation()
            if (s.historyPoints.isEmpty() && !s.history.loading) loadPortfolioHistory()
        }
    }

    private fun rememberedState() = FinanceUiState(
        categories = wanted.get<ArrayList<String>>(CATEGORIES)?.toSet() ?: emptySet(),
        historyPeriod = wanted.get<String>(PERIOD) ?: "week",
    )

    override fun loadValuation() {
        viewModelScope.launch {
            _financeState.update { it.copy(valuationLoad = Load.Loads) }
            val account = filter.accountFor(ScopeFilter.View.FINANCE)
            when (val r = finances.getValuation(account)) {
                is Outcome.Success -> {
                    _financeState.update { it.copy(valuation = r.data, valuationLoad = Load.Data(Unit)) }
                    // The account's currency comes along with the valuation; the
                    // AppViewModel remembers it for the next start.
                    session.currencyAdopted(r.data.currency)
                }
                is Outcome.Failure -> {
                    _financeState.update { it.copy(valuationLoad = loadError(r)) }
                    messages.show(messages.messageForSnackbar(r))
                }
            }
            _financeState.update { it.copy(extrasLoad = Load.Data(Unit)) }
            extra(finances.getPartsValuation(account)) { s, d -> s.copy(partsValuation = d) }
            extra(finances.getMinifigsValuation(account)) { s, d -> s.copy(figsValuation = d) }
            extra(finances.getPnl(account)) { s, d -> s.copy(pnl = d) }
        }
    }

    private fun <T> extra(r: Outcome<T>, take: (FinanceUiState, T) -> FinanceUiState) = when (r) {
        is Outcome.Success -> _financeState.update { take(it, r.data) }
        is Outcome.Failure -> _financeState.update { it.copy(extrasLoad = loadError(r)) }
    }

    /** Fetch the history for the chosen period anew. */
    fun loadPortfolioHistory() = loadPortfolioHistory(_financeState.value.historyPeriod)

    override fun loadPortfolioHistory(period: String) {
        wanted[PERIOD] = period
        viewModelScope.launch {
            _financeState.update { it.copy(history = Load.Loads, historyPeriod = period,
                historyPoints = emptyList(), historyYAxis = emptyList(), historyDays = emptyList(),
                historyPeriodChangePct = null) }
            when (val r = finances.getPortfolioHistory(period, filter.accountFor(ScopeFilter.View.FINANCE))) {
                is Outcome.Success -> _financeState.update { it.copy(
                    history                = Load.Data(Unit),
                    historyPeriodChangePct = r.data.changePercent,
                    historyPoints          = r.data.points,
                    historyYAxis           = r.data.yAxis,
                    historyDays            = r.data.days,
                    historyCurrency        = r.data.currency) }
                is Outcome.Failure -> _financeState.update { it.copy(history = loadError(r)) }
            }
        }
    }

    override fun toggleFinanceCategory(category: String) {
        _financeState.update { it.withToggledCategory(category) }
        wanted[CATEGORIES] = ArrayList(_financeState.value.categories)
    }

    override fun resetFinanceCategories() {
        _financeState.update { it.copy(categories = emptySet()) }
        wanted[CATEGORIES] = ArrayList<String>()
    }

    private fun afterFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.FINANCE) return
        loadValuation()
        loadPortfolioHistory()
    }

    private fun reset() {
        _financeState.value = FinanceUiState()
        wanted[CATEGORIES] = ArrayList<String>()
        wanted[PERIOD] = "week"
    }

    private companion object {
        const val CATEGORIES = "finanz_kategorien"
        const val PERIOD = "finanz_zeitraum"
    }
}
