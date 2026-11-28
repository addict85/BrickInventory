// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Condition
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class AddMinifigRequest(
    @SerialName("fig_number") val figNumber: String,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("fig_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val figName: String? = null,
    @SerialName("image_url") @EncodeDefault(EncodeDefault.Mode.NEVER) val imageUrl: String? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("acquired_at") @EncodeDefault(EncodeDefault.Mode.NEVER) val acquiredAt: String? = null,
)

@Serializable
data class AddMinifigResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String,
    @SerialName("fig_number") val figNumber: String,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("price_from_condition") val priceFromCondition: Condition? = null,
)

@Serializable
data class ManualFigsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("figs") val figs: List<FigValuationItem>,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class MinifigParts(
    @SerialName("success") val success: Boolean,
    @SerialName("source") val source: String,
    @SerialName("parts") val parts: List<JsonObject>,
)

@Serializable
data class MinifigStats(
    @SerialName("unique_figs") val uniqueFigs: Int,
    @SerialName("types") val types: Int,
    @SerialName("total_quantity") val totalQuantity: Int,
    @SerialName("manual") val manual: Int,
)

@Serializable
data class MinifigStatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: MinifigStats,
)
