package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.WantedItemPricesView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.WantedSort
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow

/** The wishlist: sets one does not have yet, in the store, and their takeover into the stock. */
interface WantedRepository {
    /** The wishlist from the store by search and condition, sorted as on the server. */
    fun observeWanted(search: String? = null, condition: Condition? = null,
                           sort: WantedSort? = null): Flow<Local<WantedItemView>>

    /**
     * Fetch the unfiltered wishlist from the server into the local store. It can be seen
     * only via [observeWanted]: one path for the data, the fetch only reports
     * success or error.
     */
    suspend fun refreshWanted(): Outcome<Unit>

    /** true if the item is new; false if it was already on the list. */
    suspend fun createWantedItem(setNumber: String, condition: Condition,
                                 ownerUserId: Int? = null): Outcome<Boolean>

    /** true if it was merged with an item of the target. */
    suspend fun moveWantedItem(setNumber: String, condition: Condition,
                                     ofId: Int, toId: Int): Outcome<Boolean>

    suspend fun deleteWantedItem(setNumber: String, condition: Condition,
                                  ownerUserId: Int? = null): Outcome<Unit>

    suspend fun getWantedItemPrices(setNumber: String): Outcome<WantedItemPricesView>

    /**
     * The wishlist item goes into the stock; the gallery follows in the same store.
     * true if the set was already in the stock and only the quantity rose.
     */
    suspend fun adoptWantedItem(setNumber: String, condition: Condition, quantity: Int = 1,
                                    purchasePrice: Money? = null, recordedAs: Condition? = null,
                                    ownerUserId: Int? = null,
                                    storage: String? = null): Outcome<Boolean>
}
