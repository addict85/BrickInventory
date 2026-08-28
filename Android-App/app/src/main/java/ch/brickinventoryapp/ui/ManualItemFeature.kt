package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.model.UpdateAcquisitionRequest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Feature für manuell erfasste Teile und Minifiguren:
 * Kaufpreis-Erfassungen laden, bearbeiten, löschen.
 * Shared für Parts und Figs — kein doppelter Code.
 */

internal fun MainViewModel.loadManualAcquisitions(type: String, id: String, colorId: Int = 0) {
    viewModelScope.launch {
        _manDetailState.update {
            // Beim Wechsel auf einen ANDEREN Eintrag den alten Preisstand
            // verwerfen: Die Antwort trägt keine Kennung, mit der der Dialog
            // sie zuordnen könnte — stehen bliebe der Marktpreis des zuvor
            // geöffneten Teils, bis der neue Abruf zurückkommt. Beim Neuladen
            // desselben Eintrags (nach dem Speichern) bleibt er stehen, sonst
            // flackerte die Zeile bei jeder Änderung.
            val sameItem = it.itemId == id && it.colorId == colorId && it.itemType == type
            it.copy(isLoading = true, itemType = type, itemId = id, colorId = colorId,
                    priceHistory = if (sameItem) it.priceHistory else null)
        }
        val result = when (type) {
            "fig"  -> repo.getFigAcquisitions(id)
            else   -> repo.getPartAcquisitions(id, colorId)
        }
        when (result) {
            is Result.Success -> _manDetailState.update {
                it.copy(acquisitions = result.data.acquisitions,
                        acquisitionTotals = result.data.totals,
                        isLoading = false)
            }
            is Result.Error -> _manDetailState.update { it.copy(isLoading = false) }
        }
    }
    // Marktpreis je Zustand und Verlauf gleich mitladen. Bewusst ein eigener
    // Aufruf und nicht Teil des obigen: Die Erfassungsliste soll nicht warten,
    // bis der Preisabruf durch ist — sie ist das, was der Dialog zuerst zeigt.
    loadManualPriceHistory(type, id, colorId)
}

/**
 * Marktpreis je Zustand und Preisverlauf eines manuellen Teils / einer
 * Minifigur.
 *
 * Nach jedem Speichern erneut geladen: Welche Zeilen `by_condition` enthält,
 * hängt an den Erfassungen — wird ein Kaufpreis in einem neuen Zustand
 * erfasst, taucht die Zeile dadurch von selbst auf. Dieselbe Regel wie im
 * Set-Detail.
 */
internal fun MainViewModel.loadManualPriceHistory(type: String, id: String, colorId: Int = 0) {
    viewModelScope.launch {
        _manDetailState.update { it.copy(priceHistoryLoading = true) }
        val result = when (type) {
            "fig" -> repo.getFigPriceHistory(id)
            else  -> repo.getPartPriceHistory(id, colorId)
        }
        when (result) {
            is Result.Success -> _manDetailState.update {
                it.copy(priceHistory = result.data, priceHistoryLoading = false)
            }
            is Result.Error -> _manDetailState.update { it.copy(priceHistoryLoading = false) }
        }
    }
}

internal fun MainViewModel.updateManualAcquisition(
    type: String, id: String, colorId: Int, acqId: Int,
    unitPrice: Double? = null, condition: String? = null, quantity: Int? = null, date: String? = null
) {
    viewModelScope.launch {
        // fuerStueck(): Der Server liest bei Teilen und Minifiguren `unit_price`,
        // nur bei Sets `purchase_price`. Hier stand der Preis im Set-Feld — der
        // Server fand deshalb kein Preisfeld und liess ihn unverändert, ohne
        // einen Fehler zu melden (Nachtrag 111).
        //
        // Der Parameter hiess schon immer `unitPrice`; er landete nur im
        // falschen Feld.
        val req = UpdateAcquisitionRequest.fuerStueck(
            preis = unitPrice,
            condition = condition,
            quantity = quantity,
            date = date
        )
        val result = when (type) {
            "fig"  -> repo.updateFigAcquisition(id, acqId, req)
            else   -> repo.updatePartAcquisition(id, colorId, acqId, req)
        }
        if (result is Result.Success && result.data.success) {
            loadManualAcquisitions(type, id, colorId)
            // Refresh tile list to show updated condition/price badge
            reloadItemList(type)
        } else if (result is Result.Error) {
            _snackbar.value = meldung(result)
            if (date != null) loadManualAcquisitions(type, id, colorId) // abgelehnte Datumsänderung zurücksetzen
        }
    }
}

internal fun MainViewModel.deleteManualAcquisition(
    type: String, id: String, colorId: Int, acqId: Int
) {
    viewModelScope.launch {
        val result = when (type) {
            "fig"  -> repo.deleteFigAcquisition(id, acqId)
            else   -> repo.deletePartAcquisition(id, colorId, acqId)
        }
        when (result) {
            is Result.Success -> {
                _manDetailState.update { it.copy(newQuantity = result.data.newQuantity) }
                loadManualAcquisitions(type, id, colorId)
                reloadItemList(type)
            }
            is Result.Error -> {}
        }
    }
}

/**
 * Nach einer Änderung an einem manuellen Teil oder einer Minifigur alles
 * nachladen, was den geänderten Wert anzeigt.
 *
 * ── Was vorher falsch war ───────────────────────────────────────────────────
 * Diese Funktion rief AUSSCHLIESSLICH loadValuation() auf — sie lud also nie
 * eine Liste, obwohl ihr Name genau das verspricht. Die Kachel in der Teile-
 * bzw. Minifiguren-Übersicht behielt nach einer Mengen- oder Preisänderung den
 * alten Stand, bis der Reiter erneut geöffnet wurde.
 *
 * Der Name hat den Fehler dabei verdeckt: An den Aufrufstellen sah es aus, als
 * sei die Liste versorgt.
 *
 * internal statt private: Die Funktion war dateiprivat, weil sie nur hier
 * gebraucht wurde. Seit updatePart()/updateMinifig() in PartsFeature.kt sie
 * ebenfalls aufrufen, muss sie im Modul sichtbar sein.
 */
internal fun MainViewModel.reloadItemList(type: String) {
    viewModelScope.launch {
        if (type == "fig") loadMinifigs() else loadParts()
        loadValuation()
    }
}
