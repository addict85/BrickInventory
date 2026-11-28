// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class CurrentByCondition(
    @SerialName("N") val new: CurrentPrice? = null,
    @SerialName("U") val used: CurrentPrice? = null,
)

@Serializable
data class CurrentPrice(
    @SerialName("condition") val condition: Condition,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
)

@Serializable
data class WantedItem(
    @SerialName("theme_id") val themeId: Int?,
    @SerialName("set_number") val setNumber: String,
    @SerialName("condition") val condition: Condition,
    @SerialName("created_at") val createdAt: String,
    @SerialName("user_id") val userId: Int,
    @SerialName("name") val name: String?,
    @SerialName("year") val year: Int?,
    @SerialName("num_parts") val numParts: Int?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("market_price") val marketPrice: Double?,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("owned") val owned: Boolean,
    @SerialName("alarm") val alarm: WantedItemAlert?,
    @SerialName("price_comparison_url") val priceComparisonUrl: String?,
)

@Serializable
data class WantedItemAlert(
    @SerialName("direction") val direction: AlarmDirection,
    @SerialName("threshold") val threshold: Double,
    @SerialName("triggered") val triggered: Boolean,
)

@Serializable
data class WantedItemOwnerReply(
    @SerialName("success") val success: Boolean,
    @SerialName("moved") val moved: Boolean,
    @SerialName("merged") val merged: Boolean,
    @SerialName("owner_user_id") val ownerUserId: Int?,
)

@Serializable
data class WantedItemOwnerRequest(
    @SerialName("owner_user_id") val ownerUserId: Int,
    @SerialName("new_owner") val newOwner: Int,
)

@Serializable
data class WantedItemPricesResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("current") val current: CurrentByCondition,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class WantedItemReply(
    @SerialName("success") val success: Boolean,
    @SerialName("was_new") val wasNew: Boolean,
    @SerialName("item") val item: WantedItem?,
)

@Serializable
data class WantedItemRequest(
    @SerialName("set_number") val setNumber: String,
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

@Serializable
data class WantedItemTakeoverRequest(
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class WantedItemTakeoverResponse(
    @SerialName("catalog_pending") val catalogPending: Boolean = false,
    @SerialName("name") val name: String? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String?,
    @SerialName("set_number") val setNumber: String?,
)

@Serializable
data class WantedListResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("item") val item: List<WantedItem>,
)

@Serializable
data class WantedXmlResult(
    @SerialName("success") val success: Boolean,
    @SerialName("preview") val preview: Boolean,
    @SerialName("parsed") val parsed: Int,
    @SerialName("created") val created: Int,
    @SerialName("topped_up") val toppedUp: Int,
    @SerialName("failed") val failed: Int,
    @SerialName("items") val items: List<WantedXmlResultItemsEntry>,
    @SerialName("open") val open: List<WantedXmlResultOpenEntry>,
    @SerialName("foreignTypes") val foreignTypes: Map<String, Int> = emptyMap(),
    @SerialName("withoutNumber") val withoutNumber: Int = 0,
    @SerialName("levels") val levels: Map<String, Int> = emptyMap(),
    @SerialName("colorPending") val colorPending: Int = 0,
    @SerialName("defaultCondition") val defaultCondition: String = "",
    @SerialName("aborted") val aborted: Boolean = false,
    @SerialName("corrections") val corrections: WantedXmlResultCorrections? = null,
    @SerialName("rebrickable") val rebrickable: WantedXmlResultRebrickable? = null,
)

@Serializable
data class WantedXmlResultCorrections(
    @SerialName("applied") val applied: Int,
    @SerialName("rejected") val rejected: List<JsonElement?>,
)

@Serializable
data class WantedXmlResultItemsEntry(
    @SerialName("kind") val kind: String,
    @SerialName("blId") val blId: String,
    @SerialName("quantity") val quantity: Int,
    @SerialName("outcome") val outcome: String,
    @SerialName("blColor") val blColor: Int? = null,
    @SerialName("rbId") val rbId: String? = null,
    @SerialName("rbColor") val rbColor: Int? = null,
    @SerialName("colorName") val colorName: String? = null,
    @SerialName("colorHex") val colorHex: String? = null,
    @SerialName("confidence") val confidence: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("maxPrice") val maxPrice: Double? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("nameGuessed") val nameGuessed: Boolean = false,
    @SerialName("image") val image: String? = null,
    @SerialName("reason") val reason: String? = null,
    @SerialName("reasonCode") val reasonCode: String? = null,
)

@Serializable
data class WantedXmlResultOpenEntry(
    @SerialName("kind") val kind: String,
    @SerialName("blId") val blId: String,
    @SerialName("blColor") val blColor: Int? = null,
)

@Serializable
data class WantedXmlResultRebrickable(
    @SerialName("asked") val asked: Int,
    @SerialName("found") val found: Int,
    @SerialName("filterIneffective") val filterIneffective: Boolean,
    @SerialName("aborted") val aborted: String = "",
)
