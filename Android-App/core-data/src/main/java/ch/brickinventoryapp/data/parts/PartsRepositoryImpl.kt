package ch.brickinventoryapp.data.parts

import ch.brickinventoryapp.contract.AddPartResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.HoldingPart
import ch.brickinventoryapp.contract.HoldingRequest
import ch.brickinventoryapp.contract.PartColorRequest
import ch.brickinventoryapp.contract.StorageDefaultRequest
import ch.brickinventoryapp.contract.StorageNameRequest
import ch.brickinventoryapp.contract.StorageRequest
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.collection.asRequest
import ch.brickinventoryapp.data.local.asRequest
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.asFeature
import ch.brickinventoryapp.data.repository.caughtUp
import ch.brickinventoryapp.data.repository.done
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.refreshPaged
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.data.repository.write
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.domain.PartInventory
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.PartialKey
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.domain.QuantityChange
import ch.brickinventoryapp.model.domain.Recorded
import ch.brickinventoryapp.model.domain.StockLocationView
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.FilterColumns
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OfflineStore.FollowUp
import ch.brickinventoryapp.offline.Slots
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Parts, minifigures and colors — via Retrofit; the common fetch logic stands in Fetch.kt.
 */
@Singleton
internal class PartsRepositoryImpl @Inject constructor(
    private val api: PartsApi,
    private val store: OfflineStore,
    private val retry: RetryPolicy,
) : PartsRepository {

    /** The local lists by the display's filters; they also change through things edited offline. */
    override fun observeParts(search: String?, color: ColorPicker, category: CategoryChoice, spareParts: SparePartChoice): Flow<Local<PartView>> =
        store.observe(Slots.PARTS, FilterColumns(searchText = search?.ifBlank { null }, color = color.value,
            category = category.value, sparePart = spareParts.asFeature()))

    override fun observeManualParts(search: String?): Flow<Local<ManualPartView>> =
        store.observe(Slots.MANUAL_PARTS, FilterColumns(searchText = search?.ifBlank { null }))

    override suspend fun refreshParts(): Outcome<Unit> {
        val parts = store.refreshPaged(Slots.PARTS, { r -> r.parts.map { it.asView() } }, { it.total }, retry) { page ->
            safeCall { api.getParts(null, null, null, page, pageSize = 500, excludeManual = "1") }
        }
        if (parts is Outcome.Failure) return parts
        return refreshManualParts()
    }

    /** A list without pages: the total is the length of the response. */
    override suspend fun refreshManualParts(): Outcome<Unit> =
        store.refreshPaged(Slots.MANUAL_PARTS, { r -> r.parts.map { it.asView() } }, { it.parts.size }, retry) { _ ->
            safeCall { api.getManualParts(null, null, null) }
        }

    override suspend fun getPartsStats(accounts: AccountSelection?): Outcome<PartsMetricsView?> =
        safeCall { api.getPartsStats(accounts?.request) }.mapData { it.stats?.asView() }

    /**
     * The two filter lists of the parts tab — color and category. Without
     * cache: both carry counts that change with every added part;
     * a cache would show numbers that do not match the list.
     */
    override suspend fun getPartsFilterColors(accounts: AccountSelection?): Outcome<List<FilterColorView>> =
        safeCall { api.getPartsFilterColors(accounts?.request) }.promised({ it.success }, { null }) { r -> r.colors.map { it.asView() } }

    override suspend fun getPartsCategories(accounts: AccountSelection?): Outcome<List<CategoryView>> =
        safeCall { api.getPartsCategories(accounts?.request) }.promised({ it.success }, { null }) { r -> r.categories.map { it.asView() } }

    /**
     * „Can I build this?“ — which parts of a list are already there. Without
     * cache like getSetsWithPart(): the response depends on a freely
     * assembled list; one entry per list would be a store nobody
     * invalidates when a part is added.
     */
    override suspend fun getOwnedParts(parts: List<PartialKey>,
                              accounts: AccountSelection?): Outcome<Map<PartialKey, PartInventory>> =
        safeCall { api.getOwnedParts(HoldingRequest(parts = parts.map { HoldingPart(it.number, it.color) }), accounts?.request) }
            .promised({ it.success }) { r ->
                parts.mapNotNull { t -> r.holding["${t.number}|${t.color}"]?.let { t to PartInventory(it.total, it.loose) } }.toMap()
            }

    /** Set a part's storage location; an empty text deletes it. */
    override suspend fun setPartStorage(partNumber: String, colorId: Int, location: String): Outcome<String?> =
        store.caughtUp({ r -> FollowUp.PartLocation(partNumber, colorId, r.storage).takeIf { r.success } }) {
            safeCall { api.setPartStorage(partNumber, colorId, StorageRequest(storage = location)) }
        }.promised({ it.success }) { it.storage }

    /**
     * Which storage locations are occupied. Without cache: the list is small and
     * changes with every entry — a cache would let the location just created be missing
     * from the suggestion.
     */
    override suspend fun getLocations(accounts: AccountSelection?): Outcome<List<LocationView>> =
        safeCall { api.getLocations(accounts?.request) }.promised({ it.success }) { r -> r.locations.map { it.asView() } }

    // ── The supply of storage locations ──
    //
    // Separate from getLocations(): there the occupied locations (for the filter), here the
    // selectable ones (for select field and settings); a freshly created location stands
    // only here. Without cache, because the list changes exactly when
    // someone enters something here.

    override fun observeLocationStock(): Flow<Local<StockLocationView>> =
        store.observe(Slots.STORAGE_LOCATIONS)

    /** The default comes next to the list; in the store the location itself carries it. */
    override suspend fun refreshLocationStock(): Outcome<Unit> =
        store.refreshPaged(Slots.STORAGE_LOCATIONS, { r -> r.locations.map { StockLocationView(location = it.asView(), default = it.id == r.preset?.id) } },
            { it.locations.size }, retry) { _ -> safeCall { api.getLocationStock(null) } }

    override suspend fun getLocationStock(owner: List<Int>): Outcome<List<LocationEntryView>> =
        safeCall { api.getLocationStock(owner.takeIf { it.isNotEmpty() }?.joinToString(",")) }
            .promised({ it.success }) { r -> r.locations.map { it.asView() } }

    override suspend fun createLocation(name: String): Outcome<Unit> =
        store.caughtUp({ r -> r.location?.takeIf { r.success }?.let { FollowUp.LocationCreated(it.asView()) } }) {
            safeCall { api.createLocation(StorageNameRequest(name = name)) }
        }.promised({ it.success }) { }

    override suspend fun renameLocation(id: Int, old: String, name: String): Outcome<Unit> =
        store.caughtUp({ r -> r.location?.takeIf { r.success }?.let { FollowUp.LocationRenamed(old, it.asView()) } }) {
            safeCall { api.renameLocation(id, StorageNameRequest(name = name)) }
        }.promised({ it.success }) { }

    override suspend fun deleteLocation(id: Int): Outcome<Unit> =
        store.caughtUp({ r -> FollowUp.LocationDeleted(id).takeIf { r.success } }) { safeCall { api.deleteLocation(id) } }
            .promised({ it.success }) { }

    /** The preselected storage location (star) — `null` switches the default off; what the server reports applies. */
    override suspend fun setLocationDefault(id: Int?): Outcome<Unit> =
        store.caughtUp({ r -> FollowUp.LocationDefault(r.preset?.id).takeIf { r.success } }) {
            safeCall { api.setLocationDefault(StorageDefaultRequest(id = id)) }
        }.promised({ it.success }) { }

    // ── In which sets is this part / this figure? ──
    //
    // For the detail dialog. Without cache: the response depends on exactly one
    // part and is fetched at the push of a button — one entry per part-color pair would never
    // become invalid when a set is added or disappears.
    override suspend fun getSetsWithPart(partNumber: String, colorId: Int,
                               accounts: AccountSelection?): Outcome<UsageView> =
        safeCall { api.getSetsWithPart(partNumber, colorId, accounts?.request) }.promised({ it.success }) { it.asView() }

    override suspend fun getBrickColors(): Outcome<List<ColorView>> =
        safeCall { api.getBrickColors() }.promised({ it.success }, { null }) { r -> r.colors.map { it.asView() } }

    /** Without a color NO_COLOR, never 0 (black); name and code then do not belong to it. */
    override suspend fun addPart(partNumber: String, colorId: Int, colorName: String?, colorHex: String?,
                         quantity: Int, unitPrice: Money?,
                         condition: Condition?, ownerUserId: Int?,
                         storage: String?): Outcome<Recorded> {
        val without = colorId == NO_COLOR
        val entry = PartEntry(number = partNumber, colorId = colorId, colorName = colorName.takeUnless { without },
            colorHex = colorHex.takeUnless { without }, quantity = quantity, unitPrice = unitPrice, condition = condition, owner = ownerUserId,
            storageLocation = storage)
        val request = entry.asRequest()
        return store.write(Editing.RecordPart(entry),
            { AddPartResponse(success = true, action = "gepuffert", partNumber = partNumber) }) { key ->
            safeCall { api.addPart(request, key) }
        }.promised({ it.success }) { Recorded(it.action == "added", it.partNumber, it.priceFromCondition) }
    }

    /**
     * The quantity also travels as a step from the quantity the local list shows
     * (UpdateManualItemRequest.quantityDelta).
     *
     * @param owner owner of the card; null = own account.
     */
    override suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: Condition?, owner: Int?): Outcome<Unit> {
        val previous = store.read(Slots.MANUAL_PARTS)?.list
            ?.firstOrNull { it.partNumber == partNumber && it.colorId == colorId && (owner == null || it.userId == owner) }?.quantity
        val change = QuantityChange(quantity = quantity, step = previous?.let { quantity - it }, unitPrice = unitPrice.asMoney(),
            condition = condition)
        return store.write(Editing.EditPart(partNumber, colorId, change, owner), { GenericResponse(success = true) }) { key ->
            safeCall { api.updatePart(partNumber, colorId, change.asRequest(), owner, key) }
        }.done()
    }

    /** Offline too: the part disappears from the list immediately, the server learns of it later. */
    override suspend fun deletePart(partNumber: String, colorId: Int, owner: Int?): Outcome<Unit> =
        store.write(Editing.DeletePart(partNumber, colorId, owner), { GenericResponse(success = true) }) { key ->
            safeCall { api.deletePart(partNumber, colorId, owner, key) }
        }.done()

    /**
     * Change the color of a manually added part afterwards.
     *
     * @param colorId   the old color — it says which row is meant.
     * @param newColor the new color.
     * @param owner     owner of the card; null = own account.
     */
    override suspend fun setPartColor(partNumber: String, colorId: Int, newColor: Int,
                             colorName: String?, colorHex: String?,
                             owner: Int?): Outcome<Unit> {
        val name = colorName.takeUnless { newColor == NO_COLOR }
        val hex = colorHex.takeUnless { newColor == NO_COLOR }
        return store.caughtUp({ r -> FollowUp.PartColor(partNumber, colorId, newColor, name, hex, owner).takeIf { r.success } }) {
            safeCall { api.setPartColor(partNumber, colorId, PartColorRequest(colorId = newColor, colorName = name, colorHex = hex), owner) }
        }.promised({ it.success }) { }
    }
}
