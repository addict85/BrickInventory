package ch.brickinventoryapp.data.stock

import ch.brickinventoryapp.model.outcome.Outcome
import kotlinx.coroutines.flow.Flow

/**
 * The stock between store and server, in one place: when it changed in the store (for key
 * figures the server computes over it), and fetching the server's state where a write changes
 * more than the app can apply itself (import, household, owner change). An interface so the
 * screens see neither the store nor its slots.
 */
interface StockReconciliation {
    suspend fun sets(): Outcome<Unit>
    suspend fun wantedList(): Outcome<Unit>
    suspend fun parts(): Outcome<Unit>
    suspend fun figures(): Outcome<Unit>

    /** Sets, parts and figures; the wanted list is not stock. */
    suspend fun stock()

    fun setsChanged(): Flow<Unit>
    fun partsChanged(): Flow<Unit>
    fun minifigsChanged(): Flow<Unit>
    fun inventoryChanged(): Flow<Unit>
}
