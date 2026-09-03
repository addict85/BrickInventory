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

/**
 * Die Teileliste laden — den Suchtext holt sie sich SELBST aus dem Zustand.
 *
 * Frueher war `search` ein Parameter. Damit kannte ihn nur, wer aus dem
 * Suchfeld heraus lud; `onLoadMore(page)` gab ihn nicht mit und bekam eine
 * ungefilterte Seite 2, die an eine gefilterte Seite 1 gehaengt wurde (siehe
 * PartsUiState.partsQuery). Wer den Filter aendern will, ruft
 * [setPartsQuery] — genau wie in der Galerie.
 */
internal fun MainViewModel.loadParts(page: Int = 1, debounce: Boolean = false) {
    partsJob?.cancel()
    partsJob = viewModelScope.launch {
        if (debounce) kotlinx.coroutines.delay(350)
        _partsState.update { it.copy(partsLoading = true) }
        // Nach dem Entprellen gelesen: Bei schneller Eingabe gewinnt der
        // zuletzt gestartete Auftrag, und der soll den NEUESTEN Text sehen.
        // Leer heisst "kein Filter" — die API erwartet dafuer null, nicht "".
        val suche = _partsState.value.partsQuery.ifBlank { null }
        // Ebenfalls aus dem Zustand, aus demselben Grund wie der Suchtext:
        // Als Parameter kaeme er beim Nachladen von Seite 2 nicht mit.
        val ersatzteile = _partsState.value.partsSpare.ifBlank { null }
        when (val r = retryOnNetwork { repo.teile.getParts(search = suche, page = page,
                                                     accounts = scopeFor(ScopeFilter.View.PARTS),
                                                     spare = ersatzteile) }) {
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

/**
 * Suchtext der Teileliste setzen: entprellt, damit nicht jeder Tastendruck
 * eine Abfrage ausloest. Gegenstueck zu setGalleryQuery.
 */
internal fun MainViewModel.setPartsQuery(q: String) {
    // Suchtext gewechselt: Die gemerkte Stelle zeigt auf Teile, die in der
    // neuen Liste woanders oder gar nicht stehen (ScrollMemory.kt). Die
    // Galerie vergisst sie bei jedem Filterwechsel; hier fehlte das, solange
    // der Suchtext gar nicht im Zustand stand.
    scrollMemory.vergiss("parts")
    _partsState.update { it.copy(partsQuery = q) }
    // Kein eigener Auftrag noetig: loadParts bricht partsJob selbst ab, ein
    // zweiter Tastendruck loescht also den entprellten ersten.
    loadParts(page = 1, debounce = true)
}

/**
 * Ersatzteil-Filter setzen: "" alle, "0" ohne Ersatzteile, "1" nur
 * Ersatzteile — dieselben Werte wie das Auswahlfeld der Webapp.
 *
 * Nicht entprellt: Anders als beim Tippen ist ein Klick ein fertiger Wunsch,
 * und 350 ms Warten waeren nur Traegheit.
 */
internal fun MainViewModel.setPartsSpare(wert: String) {
    // Wie beim Suchtext: Die gemerkte Scrollstelle zeigt auf Teile, die in der
    // neuen Liste woanders oder gar nicht stehen (ScrollMemory.kt).
    scrollMemory.vergiss("parts")
    _partsState.update { it.copy(partsSpare = wert) }
    loadParts(page = 1)
}

internal fun MainViewModel.loadPartsColors() {
    viewModelScope.launch {
        when (val r = repo.teile.getBrickColors()) {
            is Result.Success -> if (r.data.success) _partsState.update { it.copy(partsColors = r.data.colors) }
            // Bewusst ohne Meldung: Die Farbliste füllt nur die Auswahl im
            // Erfassungsdialog. Fehlt sie, tippt der Nutzer die Farb-ID — eine
            // Meldung beim Öffnen des Bildschirms hülfe ihm dabei nicht.
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
                    // Liste, Bewertung UND Kennzahlen — siehe reloadItemList().
                    reloadItemList("part")
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
                    // Liste, Bewertung UND Kennzahlen — siehe reloadItemList().
                    reloadItemList("fig")
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

/**
 * Manuelles Teil loeschen.
 *
 * @param owner Besitzer der KARTE. Im Haushalt zeigt der manuelle Bereich die
 *   Eintraege aller Konten; ohne diese Angabe loescht der Server die Zeile des
 *   Aufrufers — geklickt waere die fremde Karte, weg die eigene.
 */
internal fun MainViewModel.deletePart(partNumber: String, colorId: Int, owner: Int? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.deletePart(partNumber, colorId, owner)) {
            is Result.Success -> {
                if (r.data.success) { _snackbar.value = text(R.string.vm_part_deleted); reloadItemList("part") }
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

/** @param owner Besitzer der Karte — siehe [deletePart]. */
internal fun MainViewModel.deleteMinifig(figNumber: String, owner: Int? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.deleteMinifig(figNumber, owner)) {
            is Result.Success -> {
                if (r.data.success) { _snackbar.value = text(R.string.vm_minifig_deleted); reloadItemList("fig") }
                else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

/**
 * Figurenliste laden. Der Suchtext kommt aus dem Zustand, nicht als Parameter —
 * dieselbe Regel wie bei [loadParts] und der Galerie: Wer als Parameter laedt,
 * kennt den Filter nur beim Tippen; jeder andere Ladeweg (Aktualisieren,
 * Erfassen, Kontowechsel) reicht ihn nicht mit und liefert eine ungefilterte
 * Liste in eine Ansicht, deren Suchfeld weiter den alten Text zeigt.
 */
internal fun MainViewModel.loadMinifigs(debounce: Boolean = false) {
    // Kennzahlen NEBENHER holen, nicht aus der Liste rechnen: Die Liste unten
    // ist gefiltert (ohne manuell erfasste), die Kacheln sollen aber den
    // ganzen Bestand nennen — genau wie in der Webapp. Eigener Aufruf, damit
    // die Liste nicht auf die Zählung wartet.
    //
    // Beim Tippen NICHT: Die Kacheln zeigen den ganzen Bestand, den aendert ein
    // Suchtext nicht. Ohne diese Bedingung schickte jeder Tastendruck eine
    // eigene Zaehlabfrage los — und die haengt an keinem Auftrag, waere also
    // auch nicht abgebrochen worden.
    if (!debounce) viewModelScope.launch {
        when (val r = repo.teile.getMinifigStats(scopeFor(ScopeFilter.View.MINIFIGS))) {
            is Result.Success -> _partsState.update { it.copy(minifigStats = r.data.stats) }
            is Result.Error   -> Unit   // Kacheln behalten den letzten Stand
        }
    }
    minifigsJob?.cancel()
    minifigsJob = viewModelScope.launch {
        if (debounce) kotlinx.coroutines.delay(350)
        _partsState.update { it.copy(minifigsLoading = true) }
        // Nach dem Entprellen gelesen: Bei schneller Eingabe gewinnt der zuletzt
        // gestartete Auftrag, und der soll den NEUESTEN Text sehen.
        val suche = _partsState.value.minifigsQuery.ifBlank { null }
        when (val r = repo.teile.getMinifigs(scopeFor(ScopeFilter.View.MINIFIGS), suche)) {
            // Manuell erfasste Figuren schliesst jetzt der SERVER aus
            // (source=set im Repository) — sie haben ihren eigenen Bereich mit
            // editierbaren Karten. Vorher stand der Ausschluss hier als
            // `filter { it.source != "manual" }`, also ein zweites Mal neben
            // der Regel im Server-Handler.
            is Result.Success -> _partsState.update { it.copy(
                minifigs = r.data.figs, minifigsLoading = false) }
            is Result.Error   -> {
                _snackbar.value = meldung(r)
                _partsState.update { it.copy(minifigsLoading = false) }
            }
        }
    }
}

/**
 * Suchtext der Figurenliste setzen: entprellt, damit nicht jeder Tastendruck
 * eine Abfrage ausloest. Gegenstueck zu [setPartsQuery] und setGalleryQuery.
 */
internal fun MainViewModel.setMinifigsQuery(q: String) {
    _partsState.update { it.copy(minifigsQuery = q) }
    // Kein eigener Auftrag noetig: loadMinifigs bricht minifigsJob selbst ab,
    // ein zweiter Tastendruck loescht also den entprellten ersten.
    loadMinifigs(debounce = true)
}
