package ch.brickinventoryapp.finanzen.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinanzenRepository
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
import ch.brickinventoryapp.zustand.ui.fehlerklasse
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung

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
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val aenderungen: Bestandsabgleich,
    private val finanzen: FinanzenRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, FinanzAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
        // Die Bewertung rechnet der Server über den Bestand der Ablage; ändert der sich, gilt sie nicht mehr.
        viewModelScope.launch { aenderungen.bestandGeaendert().collect { loadValuation() } }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeKonto(view, value)
            nachFilter(view)
        }
    }

    override fun setLagerFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeLager(view, value)
            nachFilter(view)
        }
    }

    private val _financeState = MutableStateFlow(gemerkterZustand())
    val financeState: StateFlow<FinanceUiState> = _financeState.asStateFlow()

    private fun gemerkterZustand() = FinanceUiState(
        kategorien = gemerkt.get<ArrayList<String>>(KATEGORIEN)?.toSet() ?: emptySet(),
        historyPeriod = gemerkt.get<String>(ZEITRAUM) ?: "week",
    )

    override fun loadValuation() {
        viewModelScope.launch {
            _financeState.update { it.copy(valuationLoading = true, valuationFehler = null) }
            val konto = filter.kontoFuer(ScopeFilter.View.FINANCE)
            when (val r = finanzen.getValuation(konto)) {
                is Ergebnis.Success -> {
                    _financeState.update { it.copy(valuation = r.data.alsAnsicht(), valuationLoading = false) }
                    // Die Währung des Kontos kommt mit der Bewertung; das
                    // AppViewModel merkt sie sich für den nächsten Start.
                    sitzung.waehrungUebernommen(r.data.currency)
                }
                is Ergebnis.Error -> {
                    _financeState.update { it.copy(valuationLoading = false, valuationFehler = meldungen.meldung(r),
                        valuationFehlerKlasse = fehlerklasse(r)) }
                    meldungen.zeige(meldungen.meldungFuerSnackbar(r))
                }
            }
            (finanzen.getPartsValuation(konto) as? Ergebnis.Success)
                ?.let { r -> _financeState.update { it.copy(partsValuation = r.data.alsAnsicht()) } }
            (finanzen.getMinifigsValuation(konto) as? Ergebnis.Success)
                ?.let { r -> _financeState.update { it.copy(figsValuation = r.data.alsAnsicht()) } }
            (finanzen.getPnl(konto) as? Ergebnis.Success)
                ?.let { r -> _financeState.update { it.copy(pnl = r.data.alsAnsicht()) } }
        }
    }

    /** Den Verlauf für den gewählten Zeitraum neu holen. */
    fun loadPortfolioHistory() = loadPortfolioHistory(_financeState.value.historyPeriod)

    override fun loadPortfolioHistory(period: String) {
        gemerkt[ZEITRAUM] = period
        viewModelScope.launch {
            _financeState.update { it.copy(historyLoading = true, historyPeriod = period,
                historyPoints = emptyList(), historyYAxis = emptyList(), historyTage = emptyList(),
                historyPeriodChangePct = null) }
            when (val r = finanzen.getPortfolioHistory(period, filter.kontoFuer(ScopeFilter.View.FINANCE))) {
                is Ergebnis.Success -> _financeState.update { it.copy(
                    historyLoading         = false,
                    historyPeriodChangePct = r.data.periodChangePct,
                    historyPoints          = r.data.points.map { it.alsAnsicht() },
                    historyYAxis           = r.data.yAxis.map { it.alsAnsicht() },
                    historyTage            = r.data.chart?.x.orEmpty(),
                    historyWaehrung        = r.data.currency) }
                is Ergebnis.Error -> _financeState.update { it.copy(historyLoading = false) }
            }
        }
    }

    override fun finanzKategorieUmschalten(kategorie: String) {
        _financeState.update { it.mitUmgeschalteterKategorie(kategorie) }
        gemerkt[KATEGORIEN] = ArrayList(_financeState.value.kategorien)
    }

    override fun finanzKategorienZuruecksetzen() {
        _financeState.update { it.copy(kategorien = emptySet()) }
        gemerkt[KATEGORIEN] = ArrayList<String>()
    }

    private fun nachFilter(view: ScopeFilter.View) {
        if (view != ScopeFilter.View.FINANCE) return
        loadValuation()
        loadPortfolioHistory()
    }

    private fun zuruecksetzen() {
        _financeState.value = FinanceUiState()
        gemerkt[KATEGORIEN] = ArrayList<String>()
        gemerkt[ZEITRAUM] = "week"
    }

    private companion object {
        const val KATEGORIEN = "finanz_kategorien"
        const val ZEITRAUM = "finanz_zeitraum"
    }
}
