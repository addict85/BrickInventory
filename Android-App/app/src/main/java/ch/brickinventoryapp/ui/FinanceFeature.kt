package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import ch.brickinventoryapp.data.ScopeFilter


/**
 * Finanzen: Bewertung (Sets/Teile/Minifigs) und Portfolio-Historie.
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

// ── Finance ──────────────────────────────────────────────────────────────
internal fun MainViewModel.loadValuation() {
    viewModelScope.launch {
        _state.update { it.copy(isLoading = true) }
        when (val r = repo.getValuation(scopeFor(ScopeFilter.View.FINANCE))) {
            is Result.Success -> {
                prefs.saveCurrency(r.data.currency)
                _financeState.update { it.copy(valuation = r.data) }
                _state.update { it.copy(isLoading = false, currency = r.data.currency) }
            }
            is Result.Error -> {
                _state.update { it.copy(isLoading = false) }
                _snackbar.value = meldung(r)
            }
        }
        // Manuell erfasste Teile & Minifiguren fliessen ebenfalls in die Finanzen ein
        // Alle vier mit DEMSELBEN Filter — sonst stünde eine Summe aus einem
        // Blickfeld neben einer Aufstellung aus einem anderen.
        val acc = scopeFor(ScopeFilter.View.FINANCE)
        (repo.getPartsValuation(acc) as? Result.Success)?.let { r -> _financeState.update { it.copy(partsValuation = r.data) } }
        (repo.getMinifigsValuation(acc) as? Result.Success)?.let { r -> _financeState.update { it.copy(figsValuation = r.data) } }
        (repo.getPnl(acc) as? Result.Success)?.let { r -> _financeState.update { it.copy(pnl = r.data) } }
    }
}

internal fun MainViewModel.loadPortfolioHistory(period: String = "week") {
    viewModelScope.launch {
        // Clear old history immediately so chart shows loading state for new period
        _financeState.update { it.copy(historyLoading = true, historyPeriod = period,
            historyPoints = emptyList(), historyYAxis = emptyList(), historyPeriodChangePct = null) }
        when (val r = repo.getPortfolioHistory(period, scopeFor(ScopeFilter.View.FINANCE))) {
            is Result.Success -> {
                _financeState.update { it.copy(
                    historyLoading         = false,
                    historyPeriodChangePct = r.data.periodChangePct,
                    historyPoints          = r.data.points,
                    historyYAxis           = r.data.yAxis) }
            }
            is Result.Error -> _financeState.update { it.copy(historyLoading = false) }
        }
    }
}

/**
 * Nur die Bewertung der manuellen Teile bzw. Minifiguren nachladen.
 *
 * Die Reiter Teile und Minifiguren zeigen ihre manuell erfassten Einträge aus
 * DIESER Antwort — mit dem Filter IHRER Ansicht, nicht dem der Finanzen. Ohne
 * die beiden Aufrufe bliebe der manuelle Bereich beim Umschalten stehen; genau
 * dieser Fehler wurde in der Webapp gemeldet.
 */
internal fun MainViewModel.loadPartsValuationOnly() {
    viewModelScope.launch {
        (repo.getPartsValuation(scopeFor(ScopeFilter.View.PARTS)) as? Result.Success)
            ?.let { r -> _financeState.update { it.copy(partsValuation = r.data) } }
    }
}

internal fun MainViewModel.loadFigsValuationOnly() {
    viewModelScope.launch {
        (repo.getMinifigsValuation(scopeFor(ScopeFilter.View.MINIFIGS)) as? Result.Success)
            ?.let { r -> _financeState.update { it.copy(figsValuation = r.data) } }
    }
}
