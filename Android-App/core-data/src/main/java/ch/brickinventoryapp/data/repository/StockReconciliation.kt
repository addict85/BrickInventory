package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The stock between store and server, in one place: when it changed in the
 * store (for key figures the server computes over it — derived
 * from Room, not reported), and fetching the server's state where a write changes more
 * than the app can apply itself (import, household, owner change).
 */
@Singleton
class StockReconciliation @Inject constructor(
    private val sets: SetsRepository,
    private val wantedList: WantedRepository,
    private val parts: PartsRepository,
    private val figures: MinifigsRepository,
    private val store: OfflineStore,
) {
    suspend fun sets(): Outcome<Unit> = sets.refreshSets()
    suspend fun wantedList(): Outcome<Unit> = wantedList.refreshWanted()
    suspend fun parts(): Outcome<Unit> = parts.refreshParts()
    suspend fun figures(): Outcome<Unit> = figures.refreshMinifigs()

    suspend fun stock() {
        sets()
        parts()
        figures()
    }

    fun setsChanged(): Flow<Unit> = store.altered(Slots.SETS)
    fun partsChanged(): Flow<Unit> = store.altered(Slots.PARTS, Slots.MANUAL_PARTS)
    fun minifigsChanged(): Flow<Unit> = store.altered(Slots.FIGURES, Slots.MANUAL_FIGURES)
    fun inventoryChanged(): Flow<Unit> =
        store.altered(Slots.SETS, Slots.PARTS, Slots.MANUAL_PARTS, Slots.FIGURES, Slots.MANUAL_FIGURES)
}
