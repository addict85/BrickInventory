package ch.brickinventoryapp.data.local

import ch.brickinventoryapp.dataapi.collection.SetsRepository
import ch.brickinventoryapp.dataapi.collection.WantedRepository
import ch.brickinventoryapp.dataapi.parts.MinifigsRepository
import ch.brickinventoryapp.dataapi.parts.PartsRepository
import ch.brickinventoryapp.dataapi.stock.StockReconciliation
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/** Changes derive from Room's slots, not from reports: a write from any path shows up here. */
@Singleton
internal class StoreStockReconciliation @Inject constructor(
    private val sets: SetsRepository,
    private val wantedList: WantedRepository,
    private val parts: PartsRepository,
    private val figures: MinifigsRepository,
    private val store: OfflineStore,
) : StockReconciliation {
    override suspend fun sets(): Outcome<Unit> = sets.refreshSets()
    override suspend fun wantedList(): Outcome<Unit> = wantedList.refreshWanted()
    override suspend fun parts(): Outcome<Unit> = parts.refreshParts()
    override suspend fun figures(): Outcome<Unit> = figures.refreshMinifigs()

    override suspend fun stock() {
        sets()
        parts()
        figures()
    }

    override fun setsChanged(): Flow<Unit> = store.altered(Slots.SETS)
    override fun partsChanged(): Flow<Unit> = store.altered(Slots.PARTS, Slots.MANUAL_PARTS)
    override fun minifigsChanged(): Flow<Unit> = store.altered(Slots.FIGURES, Slots.MANUAL_FIGURES)
    override fun inventoryChanged(): Flow<Unit> =
        store.altered(Slots.SETS, Slots.PARTS, Slots.MANUAL_PARTS, Slots.FIGURES, Slots.MANUAL_FIGURES)
}
