// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")

package ch.brickinventoryapp.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class BricklinkLinks(
    @SerialName("success") val success: Boolean,
    @SerialName("links") val links: JsonObject,
)

@Serializable
data class CatalogMetaResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("themes") val themes: List<CatalogTheme>,
    @SerialName("year_min") val yearMin: Int?,
    @SerialName("year_max") val yearMax: Int?,
    @SerialName("year_counts") val yearCounts: List<CatalogYearCount>,
)

@Serializable
data class CatalogSetDetail(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String?,
    @SerialName("year") val year: Int?,
    @SerialName("theme_id") val themeId: Int?,
    @SerialName("theme_name") val themeName: String?,
    @SerialName("num_parts") val numParts: Int?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("minifigs") val minifigs: Int,
    @SerialName("owned") val owned: Boolean,
    @SerialName("owned_quantity") val ownedQuantity: Int,
    @SerialName("bricklink") val bricklink: BrickLinkRef?,
    @SerialName("price_comparison_url") val priceComparisonUrl: String?,
)

@Serializable
data class CatalogSetDetailResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set") val set: CatalogSetDetail?,
)

@Serializable
data class CatalogSetItem(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String?,
    @SerialName("year") val year: Int?,
    @SerialName("theme_id") val themeId: Int?,
    @SerialName("theme_name") val themeName: String?,
    @SerialName("num_parts") val numParts: Int?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("owned") val owned: Boolean,
    @SerialName("owned_quantity") val ownedQuantity: Int,
)

@Serializable
data class CatalogSetsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("pages") val pages: Int,
    @SerialName("sets") val sets: List<CatalogSetItem>,
)

@Serializable
data class CatalogTheme(
    @SerialName("id") val id: Int,
    @SerialName("name") val name: String,
    @SerialName("set_count") val setCount: Int,
)

@Serializable
data class CatalogYearCount(
    @SerialName("year") val year: Int,
    @SerialName("n") val n: Int,
)

@Serializable
data class CatalogYearDistributionResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("years") val years: List<YearCount>,
)

@Serializable
data class YearCount(
    @SerialName("year") val year: Int?,
    @SerialName("n") val n: Int,
)
