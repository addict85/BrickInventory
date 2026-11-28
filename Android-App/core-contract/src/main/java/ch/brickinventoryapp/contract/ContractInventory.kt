// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class Acquisition(
    @SerialName("id") val id: Int,
    @SerialName("quantity") val quantity: Int,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: Condition,
    @SerialName("created_at") val createdAt: String?,
    @SerialName("owner_user_id") val ownerUserId: Int,
    @SerialName("price_estimated") val priceEstimated: Boolean,
    @SerialName("currency") val currency: CurrencyCode?,
    @SerialName("account_price") val accountPrice: Double?,
)

@Serializable
data class AcquisitionTotals(
    @SerialName("quantity") val quantity: Int,
    @SerialName("amount") val amount: Double? = null,
    @SerialName("priced_rows") val pricedRows: Int,
    @SerialName("currency") val currency: String = "",
    @SerialName("without_rate") val withoutRate: Int = 0,
)

@Serializable
data class AcquisitionsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
    @SerialName("acquisitions") val acquisitions: List<Acquisition>,
    @SerialName("totals") val totals: AcquisitionTotals,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class DeleteWithQuantityResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("new_quantity") val newQuantity: Int = 0,
)

@Serializable
data class HoldingCleared(
    @SerialName("success") val success: Boolean,
    @SerialName("sets") val sets: Int,
    @SerialName("parts") val parts: Int,
    @SerialName("minifigs") val minifigs: Int,
    @SerialName("trash") val trash: List<Int>,
)

@Serializable
data class Restored(
    @SerialName("success") val success: Boolean,
    @SerialName("type") val type: String,
    @SerialName("number") val number: String,
    @SerialName("user_id") val userId: Int,
)

@Serializable
data class SetAggregate(
    @SerialName("set_number") val setNumber: String,
    @SerialName("condition") val condition: Condition,
    @SerialName("acq_count") val acqCount: Int,
    @SerialName("used_count") val usedCount: Int,
    @SerialName("conditions") val conditions: List<Condition>,
    @SerialName("max_purchase_price") val maxPurchasePrice: Double?,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double?,
)

@Serializable
data class Storage(
    @SerialName("minifigs") val minifigs: Int?,
    @SerialName("location") val location: String,
    @SerialName("sets") val sets: Int,
    @SerialName("parts") val parts: Int,
)

@Serializable
data class StorageDefaultRequest(
    @SerialName("id") val id: Int? = null,
)

@Serializable
data class StorageDefaultResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("preset") val preset: StorageEntry?,
)

@Serializable
data class StorageEntry(
    @SerialName("id") val id: Int,
    @SerialName("user_id") val userId: Int,
    @SerialName("name") val name: String,
)

@Serializable
data class StorageEntryResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("location") val location: StorageEntry?,
)

@Serializable
data class StorageNameRequest(
    @SerialName("name") val name: String,
    @SerialName("owner") @EncodeDefault(EncodeDefault.Mode.NEVER) val owner: JsonElement? = null,
)

@Serializable
data class StorageRequest(
    @SerialName("storage") val storage: String,
)

@Serializable
data class StorageResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("storage") val storage: String? = null,
    @SerialName("changed") val changed: Int = 0,
)

@Serializable
data class StorageStockResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("locations") val locations: List<StorageEntry>,
    @SerialName("preset") val preset: StorageEntry?,
)

@Serializable
data class StoragesResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("locations") val locations: List<Storage>,
)

@Serializable
data class Trash(
    @SerialName("success") val success: Boolean,
    @SerialName("entries") val entries: List<TrashEntry>,
)

@Serializable
data class TrashEmptied(
    @SerialName("success") val success: Boolean,
    @SerialName("removed") val removed: Int,
)

@Serializable
data class TrashEntry(
    @SerialName("id") val id: Int,
    @SerialName("type") val type: String,
    @SerialName("number") val number: String,
    @SerialName("color_id") val colorId: Int?,
    @SerialName("label") val label: String?,
    @SerialName("count") val count: Int,
    @SerialName("user_id") val userId: Int,
    @SerialName("deleted_at") val deletedAt: String,
    @SerialName("purge_at") val purgeAt: String,
)

@Serializable
data class UpdateAcquisitionRequest(
    @SerialName("quantity") val quantity: Int? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("date") val date: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("from_user_id") @EncodeDefault(EncodeDefault.Mode.NEVER) val fromUserId: JsonElement? = null,
)
