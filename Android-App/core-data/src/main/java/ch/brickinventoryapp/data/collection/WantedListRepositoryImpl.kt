package ch.brickinventoryapp.data.collection

import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.WantedItem
import ch.brickinventoryapp.contract.WantedItemOwnerRequest
import ch.brickinventoryapp.contract.WantedItemReply
import ch.brickinventoryapp.contract.WantedItemTakeoverRequest
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.local.asRequest
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.caughtUp
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.refreshPaged
import ch.brickinventoryapp.data.repository.rememberOrder
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.data.repository.sorted
import ch.brickinventoryapp.data.repository.withoutContent
import ch.brickinventoryapp.data.repository.write
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.WantedItemPricesView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.domain.WantedRequest
import ch.brickinventoryapp.model.domain.WantedSort
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

/** The wishlist via Retrofit and store. */
@Singleton
internal class WantedListRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val store: OfflineStore,
    private val retry: RetryPolicy,
) : WantedRepository {

    override fun observeWanted(search: String?, condition: Condition?, sort: WantedSort?): Flow<Local<WantedItemView>> =
        store.observe(Slots.WANTED_LIST, FilterColumns(searchText = search?.ifBlank { null }, condition = condition?.identifier))
            .map { l -> l.copy(list = l.list.sorted(rememberOrder(sort))) }

    /** The wishlist comes whole, without pages: the total is the length of the response. */
    override suspend fun refreshWanted(): Outcome<Unit> =
        store.refreshPaged(Slots.WANTED_LIST, { r -> r.item.map { it.asView() } }, { it.item.size }, retry) { _ ->
            safeCall { api.getWantedList(null, null, null, null) }
        }

    override suspend fun createWantedItem(setNumber: String, condition: Condition,
                                          ownerUserId: Int?): Outcome<Boolean> {
        val wish = WantedRequest(setNumber, condition, ownerUserId)
        val request = wish.asRequest()
        return store.write(Editing.CreateWantedItem(wish), {
            WantedItemReply(success = true, wasNew = true,
                item = WantedItem(setNumber = setNumber, condition = condition, userId = ownerUserId ?: 0))
        }) { key -> safeCall { api.createWantedItem(request, key) } }.mapData { it.wasNew }
    }

    override suspend fun moveWantedItem(setNumber: String, condition: Condition,
                                              ofId: Int, toId: Int): Outcome<Boolean> =
        store.caughtUp({ r -> FollowUp.WantedItemMoved(setNumber, condition, ofId, toId).takeIf { r.success } }) {
            safeCall { api.moveWantedItem(setNumber, condition.identifier, WantedItemOwnerRequest(ownerUserId = ofId, newOwner = toId)) }
        }.promised({ it.success }) { it.merged }

    override suspend fun deleteWantedItem(setNumber: String, condition: Condition,
                                           ownerUserId: Int?): Outcome<Unit> =
        store.write(Editing.DeleteWantedItem(setNumber, condition, ownerUserId), { GenericResponse(success = true) }) { key ->
            safeCall { api.deleteWantedItem(setNumber, condition.identifier, ownerUserId, key) }
        }.withoutContent()

    override suspend fun getWantedItemPrices(setNumber: String): Outcome<WantedItemPricesView> =
        safeCall { api.getWantedItemPrices(setNumber) }.promised({ it.success }, { null }) { it.asView() }

    override suspend fun adoptWantedItem(setNumber: String, condition: Condition, quantity: Int,
                                             purchasePrice: Money?, recordedAs: Condition?,
                                             ownerUserId: Int?,
                                             storage: String?): Outcome<Boolean> {
        val wish = EntryRequest(setNumber = setNumber, quantity = quantity, purchasePrice = purchasePrice, condition = recordedAs ?: condition,
            owner = ownerUserId, storageLocation = storage)
        return store.caughtUp({ r -> FollowUp.WantedItemAdopted(setNumber, condition, ownerUserId, wish).takeIf { r.success } }) {
            safeCall { api.adoptWantedItem(setNumber, condition.identifier,
                WantedItemTakeoverRequest(quantity = quantity, purchasePrice = purchasePrice?.asDouble(), condition = recordedAs, ownerUserId = ownerUserId, storage = storage)) }
        }.mapData { it.action == "exists" }
    }
}
