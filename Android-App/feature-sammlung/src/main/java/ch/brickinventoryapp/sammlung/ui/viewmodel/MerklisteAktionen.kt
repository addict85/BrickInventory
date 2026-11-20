package ch.brickinventoryapp.sammlung.ui.viewmodel

import kotlinx.coroutines.flow.StateFlow
import ch.brickinventoryapp.sammlung.ui.WantedItemDetailUiState
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.ScopeFilter

/** Was Merkliste und Merkposten-Detail auslösen; die Bildschirme kennen nur diese Schnittstelle. */
internal interface MerklisteAktionen {
    fun loadWanted()
    fun setScope(view: ScopeFilter.View, value: String)
    fun setWantedSearch(q: String)
    /** null: beide Zustände. */
    fun setWantedState(zustand: Zustand?)
    fun setWantedSorting(sorting: Merksortierung)
    fun legeMerkpostenAn(setNumber: String, zustand: Zustand, besitzer: Int? = null)
    fun moveWantedItem(setNumber: String, zustand: Zustand, ofId: Int, toId: Int)
    fun deleteWantedItem(setNumber: String, zustand: Zustand, besitzer: Int?)
    fun adoptWantedItem(
        setNumber: String, zustand: Zustand, besitzer: Int?,
        anzahl: Int = 1, purchasePriceRaw: String = "", recordedAs: Zustand? = null,
        lagerort: String? = null,
    )
    fun loadWantedItemDetail(setNumber: String)

    /** Das Detail eines Merkpostens, wie seine Seite es liest: Wer es zeigt, lädt es. */
    fun wantedItemDetailOf(setNumber: String): StateFlow<WantedItemDetailUiState>
    fun setPriceAlert(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand)
}
