package ch.brickinventoryapp.data.parts

import ch.brickinventoryapp.contract.AddMinifigResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.StorageRequest
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.collection.asRequest
import ch.brickinventoryapp.data.local.asRequest
import ch.brickinventoryapp.data.repository.caughtUp
import ch.brickinventoryapp.data.repository.done
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.refreshPaged
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.data.repository.write
import ch.brickinventoryapp.dataapi.parts.MinifigsRepository
import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.QuantityChange
import ch.brickinventoryapp.model.domain.Recorded
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.FilterColumns
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OfflineStore.FollowUp
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Minifigures from sets and manually added ones — via Retrofit; the common fetch logic stands in Fetch.kt.
 */
@Singleton
internal class MinifigsRepositoryImpl @Inject constructor(
    private val api: MinifigsApi,
    private val store: OfflineStore,
    private val retry: RetryPolicy,
) : MinifigsRepository {

    /** The local lists by search text, like PartsRepository.observeParts. */
    override fun observeMinifigs(search: String?): Flow<Local<FigureView>> =
        store.observe(Slots.FIGURES, FilterColumns(searchText = search?.ifBlank { null }))

    override fun observeManualMinifigs(search: String?): Flow<Local<ManualMinifigView>> =
        store.observe(Slots.MANUAL_FIGURES, FilterColumns(searchText = search?.ifBlank { null }))

    override suspend fun refreshMinifigs(): Outcome<Unit> {
        // Both lists come whole, without pages: the total is the length of the response.
        val figures = store.refreshPaged(Slots.FIGURES, { r -> r.figs.map { it.asView() } }, { it.figs.size }, retry) { _ ->
            safeCall { api.getMinifigs(source = "set") }
        }
        if (figures is Outcome.Failure) return figures
        return store.refreshPaged(Slots.MANUAL_FIGURES, { r -> r.figs.map { it.asView() } }, { it.figs.size }, retry) { _ ->
            safeCall { api.getManualMinifigs(null, null) }
        }
    }

    /** The same for a minifigure — it has no color (migration 0024). */
    override suspend fun setFigStorage(figNumber: String, location: String): Outcome<String?> =
        store.caughtUp({ r -> FollowUp.MinifigLocation(figNumber, r.storage).takeIf { r.success } }) {
            safeCall { api.setFigStorage(figNumber, StorageRequest(storage = location)) }
        }.promised({ it.success }) { it.storage }

    override suspend fun addMinifig(figNumber: String, blFigNumber: String?, quantity: Int,
                           unitPrice: Money?, condition: Condition?,
                           ownerUserId: Int?,
                           storage: String?): Outcome<Recorded> =
        FigureEntry(number = figNumber, blNumber = blFigNumber, quantity = quantity, unitPrice = unitPrice, condition = condition,
            owner = ownerUserId, storageLocation = storage).let { entry ->
            val request = entry.asRequest()
            store.write(Editing.RecordFigure(entry),
                { AddMinifigResponse(success = true, action = "gepuffert", figNumber = figNumber) }) { key ->
                safeCall { api.addMinifig(request, key) }
            }.promised({ it.success }) { Recorded(it.action == "added", it.figNumber, it.priceFromCondition) }
        }

    /**
     * Like PartsRepository.updatePart: the quantity also as a step.
     *
     * @param owner owner of the card; null = own account.
     */
    override suspend fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?, condition: Condition?, owner: Int?): Outcome<Unit> {
        val previous = store.read(Slots.MANUAL_FIGURES)?.list
            ?.firstOrNull { it.figNumber == figNumber && (owner == null || it.userId == owner) }?.quantity
        val change = QuantityChange(quantity = quantity, step = previous?.let { quantity - it }, unitPrice = unitPrice.asMoney(),
            condition = condition, blNumber = blFigNumber)
        return store.write(Editing.EditFigure(figNumber, change, owner), { GenericResponse(success = true) }) { key ->
            safeCall { api.updateMinifig(figNumber, change.asRequest(), owner, key) }
        }.done()
    }

    /** Offline too, like PartsRepository.deletePart. */
    override suspend fun deleteMinifig(figNumber: String, owner: Int?): Outcome<Unit> =
        store.write(Editing.DeleteFigure(figNumber, owner), { GenericResponse(success = true) }) { key ->
            safeCall { api.deleteMinifig(figNumber, owner, key) }
        }.done()

    override suspend fun getMinifigStats(accounts: AccountSelection?): Outcome<MinifigsMetricsView> =
        safeCall { api.getMinifigStats(accounts?.request) }.mapData { it.stats.asView() }

    override suspend fun getSetsWithMinifig(figNumber: String,
                                accounts: AccountSelection?): Outcome<UsageView> =
        safeCall { api.getSetsWithMinifig(figNumber, accounts?.request) }.promised({ it.success }) { it.asView() }
}
