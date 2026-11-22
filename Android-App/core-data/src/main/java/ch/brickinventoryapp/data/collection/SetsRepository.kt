package ch.brickinventoryapp.data.collection

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow

/**
 * The set stock: the gallery in the store and what changes it. Wishlist,
 * price alerts, catalog information and files each have their own repository —
 * a screen depends only on what it needs.
 */
interface SetsRepository {
    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Money? = null,
                       condition: Condition? = null, ownerUserId: Int? = null,
                       storage: String? = null): Outcome<SetRecorded>

    suspend fun setQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Condition? = null): Outcome<Int?>

    suspend fun changeQuantityBy(setNumber: String, step: Int): Outcome<Int?>

    suspend fun deleteSet(setNumber: String): Outcome<Unit>

    /**
     * The gallery from the store by search, theme and storage location, sorted as on the
     * server — the source of the display; [refreshSets] fills it. The view over
     * selected accounts is its own read model (Kontosicht).
     */
    fun observeSets(search: String? = null, theme: String? = null, storageLocation: String? = null,
                      sort: SetSort? = null): Flow<Local<SetView>>

    /** All pages of the unfiltered gallery into the store; the store is shown. */
    suspend fun refreshSets(): Outcome<Unit>

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Outcome<Unit>

    /** Set the storage location of a set. Empty text deletes it. */
    suspend fun setSetStorage(setNumber: String, location: String): Outcome<Unit>
}
