package ch.brickinventoryapp.dataapi.parts

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
import ch.brickinventoryapp.model.domain.PartInventory
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.PartialKey
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.domain.Recorded
import ch.brickinventoryapp.model.domain.StockLocationView
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.local.Local
import ch.brickinventoryapp.model.outcome.Outcome
import kotlinx.coroutines.flow.Flow

/**
 * Parts: stock, manually added parts, colors, storage locations.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (PartsRepositoryImpl).
 */
interface PartsRepository {
    /**
     * The parts from the store by search, color, category and spare parts; [refreshParts]
     * fills them. Account, storage location and „In Sets“ are computed only by the server: AccountView.
     */
    fun observeParts(search: String? = null, color: ColorPicker = ColorPicker.All, category: CategoryChoice = CategoryChoice.All,
                       spareParts: SparePartChoice = SparePartChoice.ALL): Flow<Local<PartView>>

    fun observeManualParts(search: String? = null): Flow<Local<ManualPartView>>

    /** All pages of the parts and the manual parts into the store; the store is shown. */
    suspend fun refreshParts(): Outcome<Unit>

    /** Only the manual parts — where the others come from the AccountView. */
    suspend fun refreshManualParts(): Outcome<Unit>

    suspend fun getPartsStats(accounts: AccountSelection? = null): Outcome<PartsMetricsView?>

    suspend fun getPartsFilterColors(accounts: AccountSelection? = null): Outcome<List<FilterColorView>>

    suspend fun getPartsCategories(accounts: AccountSelection? = null): Outcome<List<CategoryView>>

    /** The stock per requested part; what is missing has no entry. */
    suspend fun getOwnedParts(parts: List<PartialKey>,
                              accounts: AccountSelection? = null): Outcome<Map<PartialKey, PartInventory>>

    /** The location as the server saved it; null means none. */
    suspend fun setPartStorage(partNumber: String, colorId: Int, location: String): Outcome<String?>

    suspend fun getLocations(accounts: AccountSelection? = null): Outcome<List<LocationView>>

    /** The own supply of storage locations including default from the store; [refreshLocationStock] fills it. */
    fun observeLocationStock(): Flow<Local<StockLocationView>>

    suspend fun refreshLocationStock(): Outcome<Unit>

    /**
     * The supply of other owners — suggestions for the set of a sub-account. A
     * question per set, not a list of the account, hence not in the store.
     */
    suspend fun getLocationStock(owner: List<Int>): Outcome<List<LocationEntryView>>

    suspend fun createLocation(name: String): Outcome<Unit>

    /** [old]: the previous name — it stands on sets, parts and figures and gets the new name there afterwards. */
    suspend fun renameLocation(id: Int, old: String, name: String): Outcome<Unit>

    suspend fun deleteLocation(id: Int): Outcome<Unit>

    suspend fun setLocationDefault(id: Int?): Outcome<Unit>

    suspend fun getSetsWithPart(partNumber: String, colorId: Int,
                               accounts: AccountSelection? = null): Outcome<UsageView>

    suspend fun getBrickColors(): Outcome<List<ColorView>>

    suspend fun addPart(partNumber: String, colorId: Int = NO_COLOR, colorName: String? = null, colorHex: String? = null,
                         quantity: Int = 1, unitPrice: Money? = null,
                         condition: Condition? = null, ownerUserId: Int? = null,
                         storage: String? = null): Outcome<Recorded>

    suspend fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: Condition? = null, owner: Int? = null): Outcome<Unit>

    suspend fun deletePart(partNumber: String, colorId: Int, owner: Int? = null): Outcome<Unit>

    suspend fun setPartColor(partNumber: String, colorId: Int, newColor: Int,
                             colorName: String? = null, colorHex: String? = null,
                             owner: Int? = null): Outcome<Unit>
}
