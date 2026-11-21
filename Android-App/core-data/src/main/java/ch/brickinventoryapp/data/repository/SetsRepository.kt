package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.Setsortierung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.local.Local
import kotlinx.coroutines.flow.Flow

/**
 * The set stock: the gallery in the store and what changes it. Wishlist,
 * price alerts, catalog information and files each have their own repository —
 * a screen depends only on what it needs.
 */
interface SetsRepository {
    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Geld? = null,
                       condition: Zustand? = null, ownerUserId: Int? = null,
                       storage: String? = null): Ergebnis<SetRecorded>

    suspend fun setQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Zustand? = null): Ergebnis<Int?>

    suspend fun changeQuantityUm(setNumber: String, schritt: Int): Ergebnis<Int?>

    suspend fun deleteSet(setNumber: String): Ergebnis<Unit>

    /**
     * The gallery from the store by search, theme and storage location, sorted as on the
     * server — the source of the display; [aktualisiereSets] fills it. The view over
     * selected accounts is its own read model (Kontosicht).
     */
    fun observeSets(suche: String? = null, thema: String? = null, lagerort: String? = null,
                      sort: Setsortierung? = null): Flow<Local<SetAnsicht>>

    /** All pages of the unfiltered gallery into the store; the store is shown. */
    suspend fun aktualisiereSets(): Ergebnis<Unit>

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Ergebnis<Unit>

    /** Set the storage location of a set. Empty text deletes it. */
    suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<Unit>
}
