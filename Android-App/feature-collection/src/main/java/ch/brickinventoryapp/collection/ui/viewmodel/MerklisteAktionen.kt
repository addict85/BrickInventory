package ch.brickinventoryapp.collection.ui.viewmodel

import kotlinx.coroutines.flow.StateFlow
import ch.brickinventoryapp.collection.ui.WantedItemDetailUiState
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Merksortierung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.data.ScopeFilter

/** What the wishlist and wishlist-item detail trigger; the screens know only this interface. */
internal interface MerklisteAktionen {
    fun loadWanted()
    fun setScope(view: ScopeFilter.View, value: String)
    fun setWantedSearch(q: String)
    /** null: both states. */
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

    /** The detail of a wishlist item, as its page reads it: whoever shows it loads it. */
    fun wantedItemDetailOf(setNumber: String): StateFlow<WantedItemDetailUiState>
    fun setPriceAlert(setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand)
}
