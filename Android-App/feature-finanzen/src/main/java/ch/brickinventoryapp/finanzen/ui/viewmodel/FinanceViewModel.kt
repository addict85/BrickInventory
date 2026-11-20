package ch.brickinventoryapp.finanzen.ui.viewmodel

import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.zustand.ui.viewmodel.observeLoadOn
import ch.brickinventoryapp.zustand.ui.loadError
import ch.brickinventoryapp.model.ui.Laden
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.finanzen.ui.FinanceUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.sequenceSignOut

/**
 * Der Finanz-Reiter: Bewertung von Sets, Teilen und Figuren, Gewinn und
 * Verlust, Verlauf des Portfolios.
 *
 * Gewählte Zeilenarten und Zeitraum stehen im [SavedStateHandle]: Sie sind eine
 * Entscheidung des Nutzers und sollen einen Prozess-Tod überstehen, die
 * geladenen Zahlen dagegen kommen beim nächsten Öffnen ohnehin frisch.
 */
@HiltViewModel
class FinanceViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val changes: Bestandsabgleich,
    private val finanzen: FinancesRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, FinanzAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
        // Die Bewertung rechnet der Server über den Bestand der Ablage; ändert der sich, gilt sie nicht mehr.
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
            filter.setzeLager(view, value)
            afterFilter(view)
        }
    }

    private val _financeState = MutableStateFlow(rememberedState())
    val financeState: StateFlow<FinanceUiState> = _financeState.asStateFlow()

    init {
        // Wer die Finanzen sieht, lädt, was fehlt; ein Zurückkehren lädt nichts doppelt.
        observeLoadOn(_financeState) {
            val s = _financeState.value
            if (s.valuation == null && !s.bewertung.laedt) loadValuation()
            if (s.historyPoints.isEmpty() && !s.verlauf.laedt) loadPortfolioHistory()
        }
    }

    private fun rememberedState() = FinanceUiState(
        kategorien = gemerkt.get<ArrayList<String>>(CATEGORIES)?.toSet() ?: emptySet(),
        historyPeriod = gemerkt.get<String>(PERIOD) ?: "week",
    )

    override fun loadValuation() {
        viewModelScope.launch {
            _financeState.update { it.copy(bewertung = Laden.Loads) }
            val konto = filter.accountFor(ScopeFilter.View.FINANCE)
            when (val r = finanzen.getValuation(konto)) {
                is Ergebnis.Erfolg -> {
                    _financeState.update { it.copy(valuation = r.data, bewertung = Laden.Daten(Unit)) }
                    // Die Währung des Kontos kommt mit der Bewertung; das
                    // AppViewModel merkt sie sich für den nächsten Start.
                    sitzung.waehrungUebernommen(r.data.currency)
                }
                is Ergebnis.Fehler -> {
                    _financeState.update { it.copy(bewertung = loadError(r)) }
                    meldungen.zeige(meldungen.meldungFuerSnackbar(r))
                }
            }
            (finanzen.getPartsValuation(konto) as? Ergebnis.Erfolg)
                ?.let { r -> _financeState.update { it.copy(partsValuation = r.data) } }
            (finanzen.getMinifigsValuation(konto) as? Ergebnis.Erfolg)
                ?.let { r -> _financeState.update { it.copy(figsValuation = r.data) } }
            (finanzen.getPnl(konto) as? Ergebnis.Erfolg)
                ?.let { r -> _financeState.update { it.copy(pnl = r.data) } }
        }
    }

    /** Den Verlauf für den gewählten Zeitraum neu holen. */
    fun loadPortfolioHistory() = loadPortfolioHistory(_financeState.value.historyPeriod)

    override fun loadPortfolioHistory(period: String) {
        gemerkt[PERIOD] = period
        viewModelScope.launch {
            _financeState.update { it.copy(verlauf = Laden.Loads, historyPeriod = period,
                historyPoints = emptyList(), historyYAxis = emptyList(), historyDays = emptyList(),
                historyPeriodChangePct = null) }
            when (val r = finanzen.getPortfolioHistory(period, filter.accountFor(ScopeFilter.View.FINANCE))) {
                is Ergebnis.Erfolg -> _financeState.update { it.copy(
                    verlauf                = Laden.Daten(Unit),
                    historyPeriodChangePct = r.data.changePercent,
                    historyPoints          = r.data.punkte,
                    historyYAxis           = r.data.yAchse,
                    historyDays            = r.data.days,
                    historyCurrency        = r.data.waehrung) }
                is Ergebnis.Fehler -> _financeState.update { it.copy(verlauf = loadError(r)) }
            }
        }
    }

    override fun toggleFinanceCategory(kategorie: String) {
        _financeState.update { it.withToggledCategory(kategorie) }
        gemerkt[CATEGORIES] = ArrayList(_financeState.value.kategorien)
    }

    override fun resetFinanceCategories() {
        _financeState.update { it.copy(kategorien = emptySet()) }
        gemerkt[CATEGORIES] = ArrayList<String>()
    }

    private fun afterFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.FINANCE) return
        loadValuation()
        loadPortfolioHistory()
    }

    private fun reset() {
        _financeState.value = FinanceUiState()
        gemerkt[CATEGORIES] = ArrayList<String>()
        gemerkt[PERIOD] = "week"
    }

    private companion object {
        const val CATEGORIES = "finanz_kategorien"
        const val PERIOD = "finanz_zeitraum"
    }
}
