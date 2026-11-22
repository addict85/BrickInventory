package ch.brickinventoryapp.collection.ui.viewmodel

import ch.brickinventoryapp.collection.ui.WantedItemDetailUiState
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.WantedSort
import kotlinx.coroutines.flow.StateFlow

/** What the wishlist and wishlist-item detail trigger; the screens know only this interface. */
internal interface WantedListActions {
    fun loadWanted()
    fun setScope(view: ScopeFilter.View, value: String)
    fun setWantedSearch(q: String)
    /** null: both states. */
    fun setWantedState(condition: Condition?)
    fun setWantedSorting(sorting: WantedSort)
    fun createWantedItem(setNumber: String, condition: Condition, owner: Int? = null)
    fun moveWantedItem(setNumber: String, condition: Condition, ofId: Int, toId: Int)
    fun deleteWantedItem(setNumber: String, condition: Condition, owner: Int?)
    fun adoptWantedItem(
        setNumber: String, condition: Condition, owner: Int?,
        count: Int = 1, purchasePriceRaw: String = "", recordedAs: Condition? = null,
        storageLocation: String? = null,
    )
    fun loadWantedItemDetail(setNumber: String)

    /** The detail of a wishlist item, as its page reads it: whoever shows it loads it. */
    fun wantedItemDetailOf(setNumber: String): StateFlow<WantedItemDetailUiState>
    fun setPriceAlert(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition)
}
