package ch.brickinventoryapp.data.collection

import ch.brickinventoryapp.contract.AddSetResponse
import ch.brickinventoryapp.contract.MoveSetRequest
import ch.brickinventoryapp.contract.QuantityChanged
import ch.brickinventoryapp.contract.StorageRequest
import ch.brickinventoryapp.contract.UpdateQuantityRequest
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.account.GALLERY_PAGE_SIZE
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.asRecorded
import ch.brickinventoryapp.data.local.asRequest
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.caughtUp
import ch.brickinventoryapp.data.repository.done
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.refreshPaged
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.data.repository.setOrder
import ch.brickinventoryapp.data.repository.sorted
import ch.brickinventoryapp.data.repository.write
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.FilterColumns
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OfflineStore.FollowUp
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** The set stock via Retrofit and store; the common fetch logic stands in Fetch.kt. */
@Singleton
internal class SetsRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val store: OfflineStore,
    private val retry: RetryPolicy,
) : SetsRepository {

    override suspend fun addSet(setNumber: String, quantity: Int, purchasePrice: Money?,
                       condition: Condition?, ownerUserId: Int?,
                       storage: String?): Outcome<SetRecorded> {
        val wish = EntryRequest(setNumber = setNumber, quantity = quantity, purchasePrice = purchasePrice, condition = condition,
            owner = ownerUserId, storageLocation = storage)
        val request = wish.asRequest()
        return store.write(Editing.RecordSet(wish),
            { AddSetResponse(success = true, action = "gepuffert", setNumber = setNumber) }) { key ->
            safeCall { api.addSet(request, key) }
        }.promised({ it.success }) { it.asRecorded() }
    }

    override suspend fun setQuantity(setNumber: String, quantity: Int, purchasePrice: Double?, condition: Condition?): Outcome<Int?> =
        // The server may cap (foreign copies stay): its number applies.
        store.caughtUp({ r -> FollowUp.SetQuantitySet(setNumber, r.quantity ?: quantity).takeIf { r.success } }) {
            safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity = quantity, quantityDelta = null, purchasePrice = purchasePrice, condition = condition)) }
        }.promised({ it.success }) { it.quantity }

    /** Change the quantity by [step]; the server computes under the stock lock. */
    override suspend fun changeQuantityBy(setNumber: String, step: Int): Outcome<Int?> =
        store.write(Editing.SetQuantity(setNumber, step), { QuantityChanged(success = true, quantity = null) }) { key ->
            safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantityDelta = step), key) }
        }.promised({ it.success }) { it.quantity }

    /** Delete only online: the server's trash decides what comes back. */
    override suspend fun deleteSet(setNumber: String): Outcome<Unit> =
        store.caughtUp({ r -> FollowUp.SetRemoved(setNumber).takeIf { r.success } }) { safeCall { api.deleteSet(setNumber) } }.done()

    /** The gallery from the store, by the display's filters; also changes through things edited offline. */
    override fun observeSets(search: String?, theme: String?, storageLocation: String?, sort: SetSort?): Flow<Local<SetView>> =
        store.observe(Slots.SETS, FilterColumns(searchText = search?.ifBlank { null }, theme = theme?.ifBlank { null },
            storageLocation = storageLocation?.ifBlank { null })).map { l -> l.copy(list = l.list.sorted(setOrder(sort))) }

    override suspend fun refreshSets(): Outcome<Unit> =
        store.refreshPaged(Slots.SETS, { r -> r.sets.map { it.asView() } }, { it.total }, retry) { page ->
            safeCall { api.getSets(null, null, null, null, page, GALLERY_PAGE_SIZE) }
        }

    override suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>?): Outcome<Unit> =
        store.caughtUp({ r -> FollowUp.SetMoved(setNumber, fromUserId, toUserId, acquisitionIds == null).takeIf { r.success } }) {
            safeCall { api.moveSet(setNumber, MoveSetRequest(fromUserId = fromUserId, toUserId = toUserId, acquisitionIds = acquisitionIds)) }
        }.promised({ it.success }) { }

    override suspend fun setSetStorage(setNumber: String, location: String): Outcome<Unit> =
        store.caughtUp({ r -> FollowUp.SetLocation(setNumber, r.storage).takeIf { r.success } }) {
            safeCall { api.setSetStorage(setNumber, StorageRequest(storage = location)) }
        }.promised({ it.success }) { }
}
