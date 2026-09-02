package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import ch.brickinventoryapp.data.ScopeFilter


/**
 * Teile- und Minifig-Inventar: Laden, manuelle Erfassung, Inline-Edit, Löschen.
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

internal fun MainViewModel.loadParts(search: String? = null, page: Int = 1, debounce: Boolean = false) {
    partsJob?.cancel()
    partsJob = viewModelScope.launch {
        if (debounce) kotlinx.coroutines.delay(350)
        _partsState.update { it.copy(partsLoading = true) }
        when (val r = retryOnNetwork { repo.teile.getParts(search = search, page = page,
                                                     accounts = scopeFor(ScopeFilter.View.PARTS)) }) {
            is Result.Success -> {
                _partsState.update {
                    it.copy(
                        partsLoading = false,
                        parts = if (page == 1) r.data.parts else it.parts + r.data.parts,
                        partsTotal = r.data.total,
                        partsPage = page
                    )
                }
                if (page == 1) {
                    when (val s = repo.teile.getPartsStats(scopeFor(ScopeFilter.View.PARTS))) {
                        is Result.Success -> _partsState.update { it.copy(partsStats = s.data.stats) }
                        // Statistik ist Beiwerk: Scheitert sie, bleibt die
                        // Teileliste trotzdem stehen.
                        is Result.Error -> {}
                    }
                }
            }
            is Result.Error -> {
                _partsState.update { it.copy(partsLoading = false) }
                _snackbar.value = meldung(r)
            }
        }
    }
}

internal fun MainViewModel.loadPartsColors() {
    viewModelScope.launch {
        when (val r = repo.teile.getBrickColors()) {
            is Result.Success -> if (r.data.success) _partsState.update { it.copy(partsColors = r.data.colors) }
            is Result.Error -> {}
        }
    }
}

/**
 * Teil erfassen.
 *
 * ── Ohne Ladeanzeige, und das ist eine Korrektur ────────────────────────────
 * Hier standen vier `_state.copy(isLoading = …)` (in addMinifig noch einmal
 * vier). Sie hatten in dieser Domäne KEINE Wirkung: Kein Teile-Bildschirm liest
 * das Feld — die Teileliste hat `partsLoading`, die Minifiguren
 * `minifigsLoading`. Gelesen wurde es von der Galerie, der Finanzübersicht und
 * dem Anmeldeformular.
 *
 * Die Wirkung lag also ausschliesslich woanders: Wer ein Teil erfasste, liess
 * die Galerie beschäftigt aussehen und blockierte über den Wächter in
 * loadMoreSets() ihr Nachladen. Siehe AppUiState.loginLaeuft.
 */
internal fun MainViewModel.addPart(partNumber: String, colorId: Int = 0, colorName: String? = null, colorHex: String? = null,
            quantity: Int = 1, note: String? = null, unitPrice: Double? = null,
            condition: String? = null, ownerUserId: Int? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.addPart(partNumber.trim(), colorId, colorName, colorHex, quantity, note, unitPrice, condition, ownerUserId)) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = text(if (r.data.action == "added") R.string.vm_added else R.string.vm_updated, r.data.partNumber)
                    loadValuation()
                    loadParts()
                } else {
                    _snackbar.value = r.data.error ?: text(R.string.err_unknown)
                }
            }
            is Result.Error -> {
                _snackbar.value = meldung(r)
            }
        }
    }
}

internal fun MainViewModel.addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1, note: String? = null,
               unitPrice: Double? = null, condition: String? = null, ownerUserId: Int? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.addMinifig(figNumber.trim(), blFigNumber, quantity, note, unitPrice, condition, ownerUserId)) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = text(if (r.data.action == "added") R.string.vm_added else R.string.vm_updated, r.data.figNumber)
                    loadValuation()
                    loadMinifigs()
                } else {
                    _snackbar.value = r.data.error ?: text(R.string.err_unknown)
                }
            }
            is Result.Error -> {
                _snackbar.value = meldung(r)
            }
        }
    }
}

internal fun MainViewModel.updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.updatePart(partNumber, colorId, quantity, unitPrice, condition)) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = text(R.string.vm_saved)
                    // reloadItemList statt nur loadValuation: Die Kachel in der
                    // Übersicht zeigt Menge und Preis und blieb sonst auf dem
                    // alten Stand, bis der Reiter erneut geöffnet wurde.
                    reloadItemList("part")
                    // If a detail dialog is open for this item, reload its acquisitions
                    val det = _manDetailState.value
                    if (det.itemType == "part" && det.itemId == partNumber && det.colorId == colorId) {
                        loadManualAcquisitions("part", partNumber, colorId)
                    }
                } else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

internal fun MainViewModel.deletePart(partNumber: String, colorId: Int) {
    viewModelScope.launch {
        when (val r = repo.teile.deletePart(partNumber, colorId)) {
            is Result.Success -> {
                if (r.data.success) { _snackbar.value = text(R.string.vm_part_deleted); loadValuation(); loadParts() }
                else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

internal fun MainViewModel.updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: String? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.updateMinifig(figNumber, quantity, unitPrice, blFigNumber, condition)) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = text(R.string.vm_saved)
                    // reloadItemList statt nur loadValuation: Die Kachel in der
                    // Übersicht zeigt Menge und Preis und blieb sonst auf dem
                    // alten Stand, bis der Reiter erneut geöffnet wurde.
                    reloadItemList("fig")
                    // Reload acquisitions if detail dialog open for this fig
                    val det = _manDetailState.value
                    if (det.itemType == "fig" && det.itemId == figNumber) {
                        loadManualAcquisitions("fig", figNumber)
                    }
                } else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

internal fun MainViewModel.deleteMinifig(figNumber: String) {
    viewModelScope.launch {
        when (val r = repo.teile.deleteMinifig(figNumber)) {
            is Result.Success -> {
                if (r.data.success) { _snackbar.value = text(R.string.vm_minifig_deleted); loadValuation(); loadMinifigs() }
                else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

internal fun MainViewModel.loadMinifigs() {
    // Kennzahlen NEBENHER holen, nicht aus der Liste rechnen: Die Liste unten
    // ist gefiltert (ohne manuell erfasste), die Kacheln sollen aber den
    // ganzen Bestand nennen — genau wie in der Webapp. Eigener Aufruf, damit
    // die Liste nicht auf die Zählung wartet.
    viewModelScope.launch {
        when (val r = repo.teile.getMinifigStats(scopeFor(ScopeFilter.View.MINIFIGS))) {
            is Result.Success -> _partsState.update { it.copy(minifigStats = r.data.stats) }
            is Result.Error   -> Unit   // Kacheln behalten den letzten Stand
        }
    }
    viewModelScope.launch {
        _partsState.update { it.copy(minifigsLoading = true) }
        when (val r = repo.teile.getMinifigs(scopeFor(ScopeFilter.View.MINIFIGS))) {
            is Result.Success -> _partsState.update { it.copy(
                // Manuell erfasste Minifiguren werden nur noch im eigenen Bereich
                // (editierbare Karten, siehe manualFigs/FigsValuationResponse) angezeigt,
                // hier daher ausgeschlossen, um Duplikate zu vermeiden.
                minifigs = r.data.figs.filter { it.source != "manual" }, minifigsLoading = false) }
            is Result.Error   -> {
                _snackbar.value = meldung(r)
                _partsState.update { it.copy(minifigsLoading = false) }
            }
        }
    }
}
