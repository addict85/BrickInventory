package ch.brickinventoryapp.model.domain

import java.time.Instant

// Valuation, profit and key figures; amounts come ready from the server.

data class MetricsView(
    val totalSets: Int,
    val totalQuantity: Int,
    val totalInstructions: Int,
    val totalParts: Int,
    val totalMinifigs: Int,
    val partsFromSets: Int? = null,
    val partsSingle: Int? = null,
)

data class PartsValuationView(
    val currency: CurrencyCode = CurrencyCode.EUR,
    val parts: List<ManualPartView> = emptyList(),
    val totalValue: String,
    val purchasePricesForeignCurrency: Int = 0,
)

data class FiguresValuationView(
    val currency: CurrencyCode = CurrencyCode.EUR,
    val figs: List<ManualMinifigView> = emptyList(),
    val totalValue: String,
    val purchasePricesForeignCurrency: Int = 0,
)

data class ProfitView(
    val currency: CurrencyCode = CurrencyCode.EUR,
    val totals: GainSumsView,
    val sets: List<GainRowView> = emptyList(),
)

data class GainRowView(
    val setNumber: String,
    val quantity: Int = 1,
    val currentPrice: Money? = null,
    val baselinePrice: Money? = null,
    val pnlPct: String? = null,
    val baselinePnlPct: String? = null,
    val pnlAmount: Money? = null,
    val pnlPercent: Double? = null,
    val baselinePnlPercent: Double? = null,
    val tilePrice: Money? = null,
    val tilePnlPct: Double? = null,
    val tileSource: String? = null,
)

data class GainSumsView(
    val purchase: String,
    val current: String,
    val pnlPct: String? = null,
    val pnlPercent: Double? = null,
    val purchasePricesForeignCurrency: Int = 0,
    val grandTotal: String? = null,
    val positions: Int? = null,
    val positionsValued: Int? = null,
    val positionsWithoutMarketPrice: Int? = null,
    val positionsWithoutPurchasePrice: Int? = null,
    val basisCostBasis: String? = null,
    val basisMarketValue: String? = null,
    val basisPnlAmount: String? = null,
    val withoutMarketPriceCostBasis: String? = null,
    val withoutPurchasePriceMarketValue: String? = null,
)

data class ValuationView(
    val currency: CurrencyCode = CurrencyCode.EUR,
    val condition: Condition = Condition.NEW,
    val cacheTtlHours: Int? = null,
    val purchasePricesForeignCurrency: Int = 0,
    val sets: List<ValuationSetView> = emptyList(),
    val totals: SumsView = SumsView(),
)

data class ValuationSetView(
    val setNumber: String,
    val addedAt: Instant? = null,
    val name: String? = null,
    val year: Int? = null,
    val quantity: Int = 1,
    val imageLocal: String? = null,
    val imageUrl: String? = null,
    val avgPrice: Money? = null,
    val qtyAvgPrice: Money? = null,
    val totalQtyAvg: String? = null,
    val totalAvg: String? = null,
    val valueTotal: Money? = null,
    val pnlPercent: Double? = null,
    val purchasePrice: Money? = null,
    val noPrice: Boolean = false,
    val acquisitions: List<ValuationPurchaseView> = emptyList(),
    val mixed: Boolean = false,
    /** Why there is no price for this set; null if there is one. */
    val error: String? = null,
)

data class SumsView(
    val min: String = "0.00",
    val avg: String = "0.00",
    val max: String = "0.00",
)
