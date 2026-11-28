// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.NO_COLOR
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class AddPartRequest(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int = NO_COLOR,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("part_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val partName: String? = null,
    @SerialName("image_url") @EncodeDefault(EncodeDefault.Mode.NEVER) val imageUrl: String? = null,
    @SerialName("category_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val categoryName: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("acquired_at") @EncodeDefault(EncodeDefault.Mode.NEVER) val acquiredAt: String? = null,
)

@Serializable
data class AddPartResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String,
    @SerialName("part_number") val partNumber: String,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("price_from_condition") val priceFromCondition: Condition? = null,
)

@Serializable
data class BlColorTable(
    @SerialName("success") val success: Boolean,
    @SerialName("source") val source: String,
    @SerialName("map") val map: JsonObject,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class BrickColor(
    @SerialName("id") val id: Int,
    @SerialName("name") val name: String,
    @SerialName("hex") val hex: String?,
)

@Serializable
data class BrickColorsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("colors") val colors: List<BrickColor>,
)

@Serializable
data class HoldingEntry(
    @SerialName("total") val total: Int,
    @SerialName("loose") val loose: Int,
)

@Serializable
data class HoldingPart(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int,
)

@Serializable
data class HoldingRequest(
    @SerialName("parts") val parts: List<HoldingPart>,
)

@Serializable
data class HoldingResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("holding") val holding: Map<String, HoldingEntry>,
)

@Serializable
data class ManualPartsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("parts") val parts: List<PartValuationItem>,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class PartColorRequest(
    @SerialName("color_id") val colorId: Int,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
)

@Serializable
data class PartColorResponse(
    @SerialName("image") val image: String?,
    @SerialName("success") val success: Boolean,
    @SerialName("combined") val combined: Boolean,
    @SerialName("moved") val moved: Int,
    @SerialName("united") val united: Int,
)

@Serializable
data class PartsCategoriesResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("categories") val categories: List<PartsCategory>,
)

@Serializable
data class PartsCategory(
    @SerialName("category_name") val categoryName: String?,
    @SerialName("label") val label: String?,
    @SerialName("unique_parts") val uniqueParts: Int,
    @SerialName("total_quantity") val totalQuantity: Int,
)

@Serializable
data class PartsFilterColor(
    @SerialName("color_name") val colorName: String?,
    @SerialName("color_hex") val colorHex: String?,
    @SerialName("unique_parts") val uniqueParts: Int,
    @SerialName("total_quantity") val totalQuantity: Int,
)

@Serializable
data class PartsFilterColorsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("colors") val colors: List<PartsFilterColor>,
)

@Serializable
data class PartsStats(
    @SerialName("unique_parts") val uniqueParts: Int,
    @SerialName("unique_colors") val uniqueColors: Int,
    @SerialName("total_parts") val totalParts: Int,
    @SerialName("manual_parts") val manualParts: Int? = null,
)

@Serializable
data class PartsStatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: PartsStats?,
)
