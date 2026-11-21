package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.WantedItemPricesView

import ch.brickinventoryapp.model.domain.Merksortierung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow

/** The wishlist: sets one does not have yet, in the store, and their takeover into the stock. */
interface WantedRepository {
    /** The wishlist from the store by search and condition, sorted as on the server. */
    fun observeWanted(suche: String? = null, zustand: Zustand? = null,
                           sort: Merksortierung? = null): Flow<Local<WantedItemView>>

    /**
     * Fetch the unfiltered wishlist from the server into the local store. It can be seen
     * only via [observeWanted]: one path for the data, the fetch only reports
     * success or error.
     */
    suspend fun refreshWanted(): Ergebnis<Unit>

    /** true if the item is new; false if it was already on the list. */
    suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                                 ownerUserId: Int? = null): Ergebnis<Boolean>

    /** true if it was merged with an item of the target. */
    suspend fun moveWantedItem(setNumber: String, condition: Zustand,
                                     ofId: Int, toId: Int): Ergebnis<Boolean>

    suspend fun deleteWantedItem(setNumber: String, condition: Zustand,
                                  ownerUserId: Int? = null): Ergebnis<Unit>

    suspend fun getWantedItemPrices(setNumber: String): Ergebnis<WantedItemPricesView>

    /**
     * The wishlist item goes into the stock; the gallery follows in the same store.
     * true if the set was already in the stock and only the quantity rose.
     */
    suspend fun adoptWantedItem(setNumber: String, condition: Zustand, quantity: Int = 1,
                                    purchasePrice: Geld? = null, recordedAs: Zustand? = null,
                                    ownerUserId: Int? = null,
                                    storage: String? = null): Ergebnis<Boolean>
}
