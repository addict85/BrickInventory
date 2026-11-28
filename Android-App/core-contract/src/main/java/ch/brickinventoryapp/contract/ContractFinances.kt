// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class ChartPoint(
    @SerialName("x_label") val xLabel: String,
    @SerialName("value") val value: Double,
    @SerialName("y_frac") val yFrac: Double,
)

@Serializable
data class ChartYAxis(
    @SerialName("label") val label: String,
    @SerialName("value") val value: Double,
    @SerialName("frac") val frac: Double,
)

@Serializable
data class ConditionValuation(
    @SerialName("market_price") val marketPrice: Double?,
    @SerialName("purchase_price") val purchasePrice: Double?,
    @SerialName("pnl_pct") val pnlPctText: String? = null,
    @SerialName("pnl_percent") val pnlPct: Double?,
)

@Serializable
data class DashboardStats(
    @SerialName("currency") val currency: String,
    @SerialName("default_condition") val defaultCondition: String,
    @SerialName("user_default_condition") val userDefaultCondition: String?,
    @SerialName("total_sets") val totalSets: Int,
    @SerialName("total_quantity") val totalQuantity: Int,
    @SerialName("total_pieces") val totalPieces: Int,
    @SerialName("total_instructions") val totalInstructions: Int,
    @SerialName("total_parts") val totalParts: Int,
    @SerialName("set_parts") val setParts: Int? = null,
    @SerialName("manual_parts") val manualParts: Int? = null,
    @SerialName("total_minifigs") val totalMinifigs: Int,
)

@Serializable
data class FigsValuationResponse(
    @SerialName("converted_purchase_prices") val convertedPurchasePrices: Int,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("figs") val figs: List<FigValuationItem>,
    @SerialName("total_value") val totalValue: String,
    @SerialName("value_total") val valueTotal: Double?,
    @SerialName("prices_pending") val pricesPending: Int,
    @SerialName("foreign_currency_purchases") val foreignCurrencyPurchases: Int,
)

@Serializable
data class PartsValuationResponse(
    @SerialName("converted_purchase_prices") val convertedPurchasePrices: Int,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("parts") val parts: List<PartValuationItem>,
    @SerialName("total_value") val totalValue: String,
    @SerialName("value_total") val valueTotal: Double?,
    @SerialName("prices_pending") val pricesPending: Int,
    @SerialName("foreign_currency_purchases") val foreignCurrencyPurchases: Int,
)

@Serializable
data class PnlResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("totals") val totals: PnlTotals,
    @SerialName("sets") val sets: List<PnlSetRow>,
)

@Serializable
data class PnlSetRow(
    @SerialName("added_at") val addedAt: String?,
    @SerialName("condition") val condition: String,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("name") val name: String?,
    @SerialName("pnl_abs") val pnlAbs: String?,
    @SerialName("purchase_price") val purchasePrice: Double?,
    @SerialName("year") val year: Int?,
    @SerialName("set_number") val setNumber: String,
    @SerialName("quantity") val quantity: Int,
    @SerialName("current_price") val currentPrice: Double?,
    @SerialName("baseline_price") val baselinePrice: Double?,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("baseline_pnl_pct") val baselinePnlPct: String? = null,
    @SerialName("pnl_amount") val pnlAmount: Double?,
    @SerialName("pnl_percent") val pnlPercent: Double?,
    @SerialName("baseline_pnl_percent") val baselinePnlPercent: Double?,
    @SerialName("tile_price") val tilePrice: Double? = null,
    @SerialName("tile_pnl_pct") val tilePnlPct: Double? = null,
    @SerialName("tile_source") val tileSource: String? = null,
)

@Serializable
data class PnlTotals(
    @SerialName("converted_purchase_prices") val convertedPurchasePrices: Int,
    @SerialName("pnl_current") val pnlCurrent: JsonElement?,
    @SerialName("pnl_purchase") val pnlPurchase: JsonElement?,
    @SerialName("purchase") val purchase: String,
    @SerialName("current") val current: String,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_percent") val pnlPercent: Double?,
    @SerialName("foreign_currency_purchases") val foreignCurrencyPurchases: Int,
    @SerialName("sets_purchase") val setsPurchase: String,
    @SerialName("parts_purchase") val partsPurchase: String,
    @SerialName("figs_purchase") val figsPurchase: String,
    @SerialName("grand_total") val grandTotal: String,
    @SerialName("positions") val positions: Int? = null,
    @SerialName("positions_valued") val positionsValued: Int? = null,
    @SerialName("positions_without_market_price") val positionsWithoutMarketPrice: Int? = null,
    @SerialName("positions_without_purchase_price") val positionsWithoutPurchasePrice: Int? = null,
    @SerialName("baseline_cost") val baselineCost: String? = null,
    @SerialName("baseline_market_value") val baselineMarketValue: String? = null,
    @SerialName("baseline_pnl_amount") val baselinePnlAmount: String? = null,
    @SerialName("cost_without_market_price") val costWithoutMarketPrice: String? = null,
    @SerialName("market_value_without_purchase_price") val marketValueWithoutPurchasePrice: String? = null,
)

@Serializable
data class PortfolioHistoryResponse(
    @SerialName("chart") val chart: PriceChartData? = null,
    @SerialName("data_points") val dataPoints: Int?,
    @SerialName("success") val success: Boolean,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("period") val period: String,
    @SerialName("points") val points: List<ChartPoint>,
    @SerialName("y_axis") val yAxis: List<ChartYAxis>,
    @SerialName("period_change_pct") val periodChangePct: Double?,
    @SerialName("purchase_total") val purchaseTotal: String? = null,
)

@Serializable
data class PriceByCondition(
    @SerialName("N") val new: ConditionValuation? = null,
    @SerialName("U") val used: ConditionValuation? = null,
)

@Serializable
data class PriceChartData(
    @SerialName("values") val values: List<PriceChartSeries>,
    @SerialName("x") val x: List<String>,
)

@Serializable
data class PriceChartPoint(
    @SerialName("x") val x: String,
    @SerialName("y") val y: Double,
)

@Serializable
data class PriceChartSeries(
    @SerialName("name") val name: String,
    @SerialName("values") val values: List<PriceChartPoint>,
    @SerialName("firstRealIndex") val firstRealIndex: Int,
)

@Serializable
data class PriceHistoryPoint(
    @SerialName("is_purchase_price") val isPurchasePrice: Boolean = false,
    @SerialName("recorded_at") val recordedAt: String,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double?,
    @SerialName("avg_price") val avgPrice: Double?,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
)

@Serializable
data class PriceHistoryResponse(
    @SerialName("condition") val condition: String? = null,
    @SerialName("current") val current: JsonElement? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("history_new") val historyNew: List<PriceHistoryPoint>,
    @SerialName("history_used") val historyUsed: List<PriceHistoryPoint>,
    @SerialName("by_condition") val byCondition: PriceByCondition,
    @SerialName("chart") val chart: PriceChartData,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_percent") val pnlPercent: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
)

@Serializable
data class SetPriceResponse(
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("avg_price") val avgPrice: Double?,
    @SerialName("min_price") val minPrice: Double?,
    @SerialName("max_price") val maxPrice: Double?,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double?,
    @SerialName("no_price") val noPrice: Boolean,
    @SerialName("error") val error: String = "",
)

@Serializable
data class StatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: DashboardStats?,
)

@Serializable
data class Totals(
    @SerialName("min") val min: String,
    @SerialName("avg") val avg: String,
    @SerialName("max") val max: String,
    @SerialName("qty_avg") val qtyAvg: String,
)

@Serializable
data class ValuationAcquisition(
    @SerialName("id") val id: Int,
    @SerialName("condition") val condition: Condition,
    @SerialName("quantity") val quantity: Int,
    @SerialName("purchase_price") val purchasePrice: Double?,
    @SerialName("avg_price") val avgPrice: Double?,
    @SerialName("total_avg") val totalAvg: String?,
    @SerialName("value_total") val valueTotal: Double?,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_percent") val pnlPercent: Double?,
    @SerialName("created_at") val createdAt: String?,
    @SerialName("original_purchase_price") val originalPurchasePrice: Double = 0.0,
    @SerialName("purchase_currency") val purchaseCurrency: String = "",
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
)

@Serializable
data class ValuationResponse(
    @SerialName("converted_purchase_prices") val convertedPurchasePrices: Int,
    @SerialName("guide_type") val guideType: String,
    @SerialName("ttl_hours") val ttlHours: JsonElement?,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("total_value") val totalValue: String,
    @SerialName("value_total") val valueTotal: Double?,
    @SerialName("prices_pending") val pricesPending: Int,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("condition") val condition: Condition,
    @SerialName("cache_ttl_hours") val cacheTtlHours: Int,
    @SerialName("foreign_currency_purchases") val foreignCurrencyPurchases: Int,
    @SerialName("sets") val sets: List<ValuationSet>,
    @SerialName("totals") val totals: Totals,
)

@Serializable
data class ValuationSet(
    @SerialName("bl_unknown") val blUnknown: Boolean,
    @SerialName("condition") val condition: String,
    @SerialName("conditions") val conditions: List<String>,
    @SerialName("error_code") val errorCode: String? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("user_id") val userId: Int,
    @SerialName("set_number") val setNumber: String,
    @SerialName("added_at") val addedAt: String?,
    @SerialName("name") val name: String?,
    @SerialName("year") val year: Int?,
    @SerialName("quantity") val quantity: Int,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("min_price") val minPrice: Double?,
    @SerialName("avg_price") val avgPrice: Double?,
    @SerialName("max_price") val maxPrice: Double?,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double?,
    @SerialName("total_qty_avg") val totalQtyAvg: String?,
    @SerialName("price_pending") val pricePending: Boolean,
    @SerialName("total_avg") val totalAvg: String?,
    @SerialName("value_total") val valueTotal: Double?,
    @SerialName("pnl_percent") val pnlPercent: Double?,
    @SerialName("purchase_price") val purchasePrice: Double?,
    @SerialName("from_cache") val fromCache: Boolean,
    @SerialName("is_fallback") val isFallback: Boolean,
    @SerialName("condition_used") val conditionUsed: Condition? = null,
    @SerialName("no_price") val noPrice: Boolean,
    @SerialName("acquisitions") val acquisitions: List<ValuationAcquisition>,
    @SerialName("mixed") val mixed: Boolean,
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("error") val error: String? = null,
)
