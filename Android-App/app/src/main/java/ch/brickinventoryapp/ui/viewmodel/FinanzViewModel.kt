package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.FinanceUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Der Finanz-Reiter: Bewertung von Sets, Teilen und Figuren, Gewinn und
 * Verlust, Verlauf des Portfolios.
 *
 * Gewählte Zeilenarten und Zeitraum stehen im [SavedStateHandle]: Sie sind eine
 * Entscheidung des Nutzers und sollen einen Prozess-Tod überstehen, die
 * geladenen Zahlen dagegen kommen beim nächsten Öffnen ohnehin frisch.
 */
@HiltViewModel
class FinanzViewModel @Inject constructor(
    dienste: AppDienste,
    private val finanzen: FinanzenRepository,
    private val gemerkt: SavedStateHandle,
) : BereichsViewModel(dienste) {

    private val _financeState = MutableStateFlow(gemerkterZustand())
    val financeState: StateFlow<FinanceUiState> = _financeState.asStateFlow()

    private fun gemerkterZustand() = FinanceUiState(
        kategorien = gemerkt.get<ArrayList<String>>(KATEGORIEN)?.toSet() ?: emptySet(),
        historyPeriod = gemerkt.get<String>(ZEITRAUM) ?: "week",
    )

    fun loadValuation() {
        viewModelScope.launch {
            _financeState.update { it.copy(valuationLoading = true) }
            val konto = scopeFor(ScopeFilter.View.FINANCE)
            when (val r = finanzen.getValuation(konto)) {
                is Result.Success -> {
                    _financeState.update { it.copy(valuation = r.data, valuationLoading = false) }
                    // Die Währung des Kontos kommt mit der Bewertung; das
                    // AppViewModel merkt sie sich für den nächsten Start.
                    dienste.sitzung.aendere { it.copy(currency = r.data.currency) }
                }
                is Result.Error -> {
                    _financeState.update { it.copy(valuationLoading = false) }
                    _snackbar.value = meldungFuerSnackbar(r)
                }
            }
            (finanzen.getPartsValuation(konto) as? Result.Success)
                ?.let { r -> _financeState.update { it.copy(partsValuation = r.data) } }
            (finanzen.getMinifigsValuation(konto) as? Result.Success)
                ?.let { r -> _financeState.update { it.copy(figsValuation = r.data) } }
            (finanzen.getPnl(konto) as? Result.Success)
                ?.let { r -> _financeState.update { it.copy(pnl = r.data) } }
        }
    }

    fun loadPortfolioHistory(period: String = _financeState.value.historyPeriod) {
        gemerkt[ZEITRAUM] = period
        viewModelScope.launch {
            _financeState.update { it.copy(historyLoading = true, historyPeriod = period,
                historyPoints = emptyList(), historyYAxis = emptyList(), historyPeriodChangePct = null) }
            when (val r = finanzen.getPortfolioHistory(period, scopeFor(ScopeFilter.View.FINANCE))) {
                is Result.Success -> _financeState.update { it.copy(
                    historyLoading         = false,
                    historyPeriodChangePct = r.data.periodChangePct,
                    historyPoints          = r.data.points,
                    historyYAxis           = r.data.yAxis) }
                is Result.Error -> _financeState.update { it.copy(historyLoading = false) }
            }
        }
    }

    fun finanzKategorieUmschalten(kategorie: String) {
        _financeState.update { it.mitUmgeschalteterKategorie(kategorie) }
        gemerkt[KATEGORIEN] = ArrayList(_financeState.value.kategorien)
    }

    fun finanzKategorienZuruecksetzen() {
        _financeState.update { it.copy(kategorien = emptySet()) }
        gemerkt[KATEGORIEN] = ArrayList<String>()
    }

    override fun nachFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.FINANCE) return
        loadValuation()
        loadPortfolioHistory()
    }

    override fun beiAenderung(aenderung: Aenderung) {
        when (aenderung) {
            Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren,
            is Aenderung.SetZusammenfassung -> loadValuation()
            Aenderung.Merkliste, Aenderung.Alarme -> Unit
        }
    }

    override fun zuruecksetzen() {
        _financeState.value = FinanceUiState()
        gemerkt[KATEGORIEN] = ArrayList<String>()
        gemerkt[ZEITRAUM] = "week"
    }

    private companion object {
        const val KATEGORIEN = "finanz_kategorien"
        const val ZEITRAUM = "finanz_zeitraum"
    }
}
